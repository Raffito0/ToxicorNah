from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import os
# from .models import db, User
from flask_login import LoginManager
from flask_migrate import Migrate
from datetime import timedelta
from flask_session import Session
import sys

db = SQLAlchemy()
login_manager = LoginManager()
migrate = Migrate()

def get_db_path():
    if getattr(sys, 'frozen', False):  # App is running as .exe
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.abspath(os.path.dirname(__file__))

    db_dir = os.path.join(base_dir, 'user_data')
    os.makedirs(db_dir, exist_ok=True)
    return os.path.join(db_dir, 'app.db')


def ensure_columns(db):
    """Add new columns to existing tables. Safe to run multiple times.

    SQLAlchemy's create_all() creates new tables but cannot add columns
    to existing tables. This function uses raw ALTER TABLE ADD COLUMN
    statements. Each is wrapped in try/except -- if the column already
    exists, SQLite raises 'duplicate column name' which we catch and ignore.
    """
    alter_statements = [
        # Bot table new columns (section-02)
        "ALTER TABLE bot ADD COLUMN platform VARCHAR(20) DEFAULT 'instagram'",
        "ALTER TABLE bot ADD COLUMN phone_ref_id INTEGER REFERENCES phone(id)",
        "ALTER TABLE bot ADD COLUMN proxy_id INTEGER REFERENCES proxy(id)",
        "ALTER TABLE bot ADD COLUMN timing_preset_id INTEGER REFERENCES timing_preset(id)",
        "ALTER TABLE bot ADD COLUMN always_on BOOLEAN DEFAULT 0",
        "ALTER TABLE bot ADD COLUMN dry_run BOOLEAN DEFAULT 0",
        "ALTER TABLE bot ADD COLUMN control_status VARCHAR(20) DEFAULT 'stopped'",
        "ALTER TABLE bot ADD COLUMN scrcpy_port INTEGER",
        # BotAccount table new columns (section-02)
        "ALTER TABLE bot_account ADD COLUMN platform VARCHAR(20) DEFAULT 'instagram'",
        "ALTER TABLE bot_account ADD COLUMN personality_json JSON",
        "ALTER TABLE bot_account ADD COLUMN personality_history_json JSON",
        "ALTER TABLE bot_account ADD COLUMN personality_locked_traits JSON",
        "ALTER TABLE bot_account ADD COLUMN warmup_json JSON",
        "ALTER TABLE bot_account ADD COLUMN niche_json JSON",
        "ALTER TABLE bot_account ADD COLUMN notify_before_post BOOLEAN DEFAULT 1",
        # InterventionLog new columns (section-03 remote intervention)
        "ALTER TABLE intervention_log ADD COLUMN bot_id INTEGER REFERENCES bot(id)",
    ]

    from sqlalchemy import text
    for stmt in alter_statements:
        try:
            db.session.execute(text(stmt))
        except Exception:
            pass  # Column already exists — safe to ignore
    db.session.commit()


def create_app():
    app = Flask(__name__)

    # Ensure the instance folder exists
    # instance_path = os.path.join(app.instance_path, 'app.db')
    # if not os.path.exists(app.instance_path):
    #     os.makedirs(app.instance_path)
    db_path = get_db_path()
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY']=os.urandom(24)
    db.init_app(app)
    migrate = Migrate(app, db)

    # Configure session
    app.permanent_session_lifetime = timedelta(days=7)
    app.config['SESSION_REFRESH_EACH_REQUEST'] = True
    app.config.from_object('config.Config')
    Session(app)

    # Ensure full schema exists (safe on both fresh and existing DBs)
    with app.app_context():
        from . import models
        db.create_all()
        ensure_columns(db)

    # Add Weekly & Daily Plan to Python path for planner imports
    planner_parent = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'Weekly & Daily Plan'))
    if os.path.isdir(planner_parent) and planner_parent not in sys.path:
        sys.path.insert(0, planner_parent)

    # Enable SQLite WAL mode for concurrent reads
    from sqlalchemy import text
    with app.app_context():
        try:
            db.session.execute(text("PRAGMA journal_mode=WAL"))
            db.session.commit()
        except Exception:
            pass

    # Add phone-bot to Python path for TikTok engine imports
    # phone-bot/ uses relative imports (from .. import config), so the PARENT
    # directory must be in sys.path and phone-bot must be importable as a package.
    # Since 'phone-bot' has a hyphen, we add a phone_bot symlink.
    project_root = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..'))
    phone_bot_src = os.path.join(project_root, 'phone-bot')
    phone_bot_link = os.path.join(project_root, 'phone_bot')
    if os.path.isdir(phone_bot_src):
        # Create symlink phone_bot -> phone-bot (skip if exists or can't create)
        if not os.path.exists(phone_bot_link):
            try:
                os.symlink(phone_bot_src, phone_bot_link, target_is_directory=True)
            except OSError:
                pass  # No admin rights for symlinks on Windows — use junction
                try:
                    import subprocess
                    subprocess.run(['cmd', '/c', 'mklink', '/J', phone_bot_link, phone_bot_src],
                                   capture_output=True)
                except Exception:
                    pass
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

    login_manager.init_app(app)
    login_manager.login_view = 'auth.signin'
    login_manager.login_message_category = 'info'

    # Import and register the blueprints
    from .routes import auth
    from .analysis_routes import analysis
    from .proxy_routes import proxy_bp
    from .planner_routes import planner_bp
    from .personality_routes import personality_bp
    from .timing_routes import timing_bp_api
    from .content_routes import content_bp
    from .intervention_routes import intervention_bp
    app.register_blueprint(auth)
    app.register_blueprint(analysis)
    app.register_blueprint(proxy_bp)
    app.register_blueprint(planner_bp)
    app.register_blueprint(personality_bp)
    app.register_blueprint(timing_bp_api)
    app.register_blueprint(content_bp)
    app.register_blueprint(intervention_bp)

    # Start proxy health-check thread (skip in tests)
    if not app.config.get('TESTING'):
        from .proxy_health import start_health_check
        start_health_check(app)

    # Handle favicon.ico requests to prevent 404 errors
    @app.route('/favicon.ico')
    def favicon():
        from flask import send_from_directory
        import os
        favicon_path = os.path.join(app.root_path, 'static')
        # Try to serve favicon.ico if it exists, otherwise return 204 No Content
        if os.path.exists(os.path.join(favicon_path, 'favicon.ico')):
            return send_from_directory(favicon_path, 'favicon.ico', mimetype='image/vnd.microsoft.icon')
        else:
            return '', 204

    return app


