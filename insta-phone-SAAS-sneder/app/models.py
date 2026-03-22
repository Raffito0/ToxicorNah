import os
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from . import db
from datetime import datetime,timezone,time


class Phone(db.Model):
    __tablename__ = 'phone'

    id = db.Column(db.Integer, primary_key=True, autoincrement=False)
    name = db.Column(db.String(100), nullable=False)
    model = db.Column(db.String(100), nullable=False)
    adb_serial = db.Column(db.String(100), nullable=True)
    screen_w = db.Column(db.Integer, default=1080)
    screen_h = db.Column(db.Integer, default=2220)
    density = db.Column(db.Integer, default=420)
    retry_tolerance = db.Column(db.Integer, default=3)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Proxy(db.Model):
    __tablename__ = 'proxy'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    host = db.Column(db.String(255), nullable=False)
    port = db.Column(db.Integer, nullable=False)
    username_env = db.Column(db.String(100), nullable=False)
    password_env = db.Column(db.String(100), nullable=False)
    rotation_url_env = db.Column(db.String(100), nullable=True)
    hotspot_ssid = db.Column(db.String(100), nullable=True)
    hotspot_password_env = db.Column(db.String(100), nullable=True)
    current_ip = db.Column(db.String(45), nullable=True)
    status = db.Column(db.String(20), default='active')
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    rotations = db.relationship('ProxyRotation', backref='proxy', lazy='dynamic')

    @property
    def socks5_url(self) -> str:
        """Compute SOCKS5 URL from components + env vars.
        Raises KeyError if env vars are not set."""
        username = os.environ[self.username_env]
        password = os.environ[self.password_env]
        return f"socks5://{username}:{password}@{self.host}:{self.port}"


class ProxyRotation(db.Model):
    __tablename__ = 'proxy_rotation'

    id = db.Column(db.Integer, primary_key=True)
    proxy_id = db.Column(db.Integer, db.ForeignKey('proxy.id'), nullable=False)
    old_ip = db.Column(db.String(45), nullable=False)
    new_ip = db.Column(db.String(45), nullable=True)
    rotated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    triggered_by = db.Column(db.String(100), nullable=False)
    phone_id = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(20), nullable=False)
    error_message = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.Index('ix_proxy_rotation_history', 'proxy_id', 'rotated_at'),
    )


class TimingPreset(db.Model):
    __tablename__ = 'timing_preset'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    params_json = db.Column(db.JSON, nullable=False)
    is_default = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class TimingOverride(db.Model):
    __tablename__ = 'timing_override'

    id = db.Column(db.Integer, primary_key=True)
    bot_id = db.Column(db.Integer, db.ForeignKey('bot.id'), nullable=False)
    param_name = db.Column(db.String(100), nullable=False)
    median = db.Column(db.Float, nullable=False)
    sigma = db.Column(db.Float, nullable=False)
    min_val = db.Column(db.Float, nullable=False)
    max_val = db.Column(db.Float, nullable=False)

    __table_args__ = (
        db.UniqueConstraint('bot_id', 'param_name', name='uq_timing_override_bot_param'),
    )


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), nullable=False, unique=True)
    email = db.Column(db.String(150), nullable=False, unique=True)
    password = db.Column(db.String(150), nullable=False)
    
    start_parts = db.relationship('StartPart', backref='user', lazy=True, cascade='all, delete-orphan')
    body_parts = db.relationship('BodyPart', backref='user', lazy=True, cascade='all, delete-orphan')
    end_parts = db.relationship('EndPart', backref='user', lazy=True, cascade='all, delete-orphan')
    bots = db.relationship('Bot', backref='user', lazy=True, cascade='all, delete-orphan')
    to_messages = db.relationship('ToMessage', backref='user', lazy=True, cascade='all, delete-orphan')
    messaged = db.relationship('Messaged', backref='user', lazy=True, cascade='all, delete-orphan')

class Bot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    phone_id = db.Column(db.String(150), nullable=False)
    status = db.Column(db.String(20), default='stopped')  # active, paused, stopped
    name = db.Column(db.String(150), nullable=False)
    should_stop = db.Column(db.Boolean, default=False)
   
   # Scheduling
    start_exec_from = db.Column(db.Time, default=time(6, 30))
    start_exec_to   = db.Column(db.Time, default=time(7, 0))
    stop_exec_from  = db.Column(db.Time, default=time(14, 0))
    stop_exec_to    = db.Column(db.Time, default=time(15, 0))

    # Wait times
    same_account_wait_min = db.Column(db.Integer, default=5)
    same_account_wait_max = db.Column(db.Integer, default=7)
    diff_account_wait_min = db.Column(db.Integer, default=25)
    diff_account_wait_max = db.Column(db.Integer, default=40)

    # Sessions
    sessions_per_account_min = db.Column(db.Integer, default=2)
    sessions_per_account_max = db.Column(db.Integer, default=2)
    session_duration_min = db.Column(db.Integer, default=80)
    session_duration_max = db.Column(db.Integer, default=120)

    # Pauses
    pause_during_session_min = db.Column(db.Integer, default=6)
    pause_during_session_max = db.Column(db.Integer, default=11)
    pause_probability_min = db.Column(db.Integer, default=90)
    pause_probability_max = db.Column(db.Integer, default=100)
    pauses_per_session_min = db.Column(db.Integer, default=2)
    pauses_per_session_max = db.Column(db.Integer, default=4)

    # Browse
    browse_ig_start_min = db.Column(db.Integer, default=63)
    browse_ig_start_max = db.Column(db.Integer, default=124)
    browse_ig_action_min = db.Column(db.Integer, default=90)
    browse_ig_action_max = db.Column(db.Integer, default=120)
    browse_ig_action_probability_min = db.Column(db.Integer, default=60)
    browse_ig_action_probability_max = db.Column(db.Integer, default=80)

    # Typing
    typing_speed_min = db.Column(db.Integer, default=2)
    typing_speed_max = db.Column(db.Integer, default=5)

    # ─── New fields (section-02) ───────────────────────────────────
    platform = db.Column(db.String(20), default='instagram')
    phone_ref_id = db.Column(db.Integer, db.ForeignKey('phone.id'), nullable=True)
    proxy_id = db.Column(db.Integer, db.ForeignKey('proxy.id'), nullable=True)
    timing_preset_id = db.Column(db.Integer, db.ForeignKey('timing_preset.id'), nullable=True)
    always_on = db.Column(db.Boolean, default=False)
    dry_run = db.Column(db.Boolean, default=False)
    control_status = db.Column(db.String(20), default='stopped')
    scrcpy_port = db.Column(db.Integer, nullable=True)

    accounts = db.relationship('BotAccount', backref='bot', lazy=True, cascade='all, delete-orphan')
    leads = db.relationship('ToMessage', backref='assigned_bot', lazy=True, cascade='all, delete-orphan')
    history = db.relationship('Messaged', backref='assigned_bot', lazy=True, cascade='all, delete-orphan')

    __table_args__ = (
        db.UniqueConstraint('user_id', 'phone_id', name='uq_user_phone'),
        db.UniqueConstraint('user_id', 'name', name='uq_user_botname'),
    )
 

class BotAccount(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bot_id = db.Column(db.Integer, db.ForeignKey('bot.id'), nullable=False)
    clone_id = db.Column(db.String(150), nullable=False)
    
    # Basic account info
    username = db.Column(db.String(150), nullable=False)
    password = db.Column(db.String(150), nullable=False)
    session_data = db.Column(db.LargeBinary())
    verification_code = db.Column(db.String(10))
    status = db.Column(db.String(20), default='pending')
    total_messages_sent = db.Column(db.Integer, default=0)
    
    # account started time
    account_started = db.Column(db.DateTime)
    account_stoped = db.Column(db.DateTime)
    total_session_made = db.Column(db.Integer, default=0)
    
    # Action tracking fields
    follows_done_today = db.Column(db.Integer, default=0)
    likes_done_today = db.Column(db.Integer, default=0) 
    dms_done_today = db.Column(db.Integer, default=0)
    follows_done_this_hour = db.Column(db.Integer, default=0)
    likes_done_this_hour = db.Column(db.Integer, default=0)
    dms_done_this_hour = db.Column(db.Integer, default=0)
    last_action_date = db.Column(db.Date)  # Track when counts were last updated
    last_action_reset = db.Column(db.DateTime)  # Track which hour (0-23) was last updated
    last_followers_scrape_date = db.Column(db.Date)
    last_follow_time = db.Column(db.DateTime)  # Track when last follow action was executed
    last_dm_time = db.Column(db.DateTime)  # Track when last DM action was executed

    # Follow settings
    follow_per_session_min = db.Column(db.Integer, default=10)
    follow_per_session_max = db.Column(db.Integer, default=14)
    follow_per_hour_min = db.Column(db.Integer, default=5)
    follow_per_hour_max = db.Column(db.Integer, default=7)
    follow_per_day_min = db.Column(db.Integer, default=20)
    follow_per_day_max = db.Column(db.Integer, default=30)
    follow_delay_min = db.Column(db.Integer, default=90)
    follow_delay_max = db.Column(db.Integer, default=130)
    
    # Likes settings
    likes_per_session_min = db.Column(db.Integer, default=10)
    likes_per_session_max = db.Column(db.Integer, default=14)
    likes_per_hour_min = db.Column(db.Integer, default=5)
    likes_per_hour_max = db.Column(db.Integer, default=7)
    likes_per_day_min = db.Column(db.Integer, default=20)
    likes_per_day_max = db.Column(db.Integer, default=30)
    likes_per_target_profile_min = db.Column(db.Integer, default=0)
    likes_per_target_profile_max = db.Column(db.Integer, default=3)
    liking_target_profile_posts_probability_min = db.Column(db.Integer, default=80)
    liking_target_profile_posts_probability_max = db.Column(db.Integer, default=90)
    delay_between_target_profile_posts_likes_min = db.Column(db.Integer, default=40)
    delay_between_target_profile_posts_likes_max = db.Column(db.Integer, default=70)
    
    # DMs settings
    dms_per_session_min = db.Column(db.Integer, default=10)
    dms_per_session_max = db.Column(db.Integer, default=14)
    dms_per_hour_min = db.Column(db.Integer, default=5)
    dms_per_hour_max = db.Column(db.Integer, default=7)
    dms_per_day_min = db.Column(db.Integer, default=20)
    dms_per_day_max = db.Column(db.Integer, default=30)
    dms_delay_min = db.Column(db.Integer, default=60)
    dms_delay_max = db.Column(db.Integer, default=90)
    dm_only_followers = db.Column(db.Boolean, default=True)
    profile_to_take_highlight_from = db.Column(db.String(255), default='')
    highlight_number = db.Column(db.Integer, default=1)
    changehighlightnumber = db.Column(db.Boolean, default=False)
    text_dm_sent_probability_min = db.Column(db.Integer, default=70)
    text_dm_sent_probability_max = db.Column(db.Integer, default=80)
    long_term_delay_highlight_text_dm_min = db.Column(db.Integer, default=5)
    long_term_delay_highlight_text_dm_max = db.Column(db.Integer, default=24)
    short_term_delay_probability_min = db.Column(db.Integer, default=40)
    short_term_delay_probability_max = db.Column(db.Integer, default=50)
    short_term_delay_highlight_text_dm_min = db.Column(db.Integer, default=60)
    short_term_delay_highlight_text_dm_max = db.Column(db.Integer, default=100)
    long_term_delay_probability_min = db.Column(db.Integer, default=50)
    long_term_delay_probability_max = db.Column(db.Integer, default=60)
    
    # Browse IG Actions
    watch_stories_probability_min = db.Column(db.Integer, default=70)
    watch_stories_probability_max = db.Column(db.Integer, default=80)
    watch_reels_probability_min = db.Column(db.Integer, default=80)
    watch_reels_probability_max = db.Column(db.Integer, default=90)
    scroll_feed_probability_min = db.Column(db.Integer, default=90)
    scroll_feed_probability_max = db.Column(db.Integer, default=100)
    scroll_explore_page_probability_min = db.Column(db.Integer, default=70)
    scroll_explore_page_probability_max = db.Column(db.Integer, default=80)
    like_probability_during_browse_min = db.Column(db.Integer, default=60)
    like_probability_during_browse_max = db.Column(db.Integer, default=70)
    
    # ─── New fields (section-02) ───────────────────────────────────
    platform = db.Column(db.String(20), default='instagram')
    personality_json = db.Column(db.JSON, nullable=True)
    personality_history_json = db.Column(db.JSON, nullable=True)
    personality_locked_traits = db.Column(db.JSON, nullable=True)
    warmup_json = db.Column(db.JSON, nullable=True)
    niche_json = db.Column(db.JSON, nullable=True)
    notify_before_post = db.Column(db.Boolean, default=True)

    @property
    def warmup_completed(self) -> bool:
        """Read warmup completion from JSON (single source of truth)."""
        if self.warmup_json is None:
            return False
        return self.warmup_json.get('completed', False)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Add relationships to handle cascading deletes for BotAccount
    followers = db.relationship('AccountFollowers', backref='account', lazy=True, cascade='all, delete-orphan')
    follows = db.relationship('Follow', backref='bot_account', lazy=True, cascade='all, delete-orphan')
    message_states = db.relationship('MessageState', backref='bot_account', lazy=True, cascade='all, delete-orphan')
   
    __table_args__ = (
        db.UniqueConstraint('bot_id', 'clone_id', name='uq_clone_id'),
    )
 

class StartPart(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

class BodyPart(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

class EndPart(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

class ToMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), nullable=False)
    first_name = db.Column(db.String(150), nullable=True)
    last_name = db.Column(db.String(150), nullable=True)
    phone = db.Column(db.String(150), nullable=True)
    bot = db.Column(db.String(150), nullable=True)
    verified = db.Column(db.Boolean, nullable=True)
    restricted = db.Column(db.Boolean, nullable=True)
    scam = db.Column(db.Boolean, nullable=True)
    fake = db.Column(db.Boolean, nullable=True)
    premium = db.Column(db.Boolean, nullable=True)
    access_hash = db.Column(db.String(150), nullable=True)
    lang_code = db.Column(db.String(10), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    bot_id = db.Column(db.Integer, db.ForeignKey('bot.id'), nullable=True)  # New field for bot association

class Messaged(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    bot_id = db.Column(db.Integer, db.ForeignKey('bot.id'), nullable=True)  # New field for bot association
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class AccountFollowers(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('bot_account.id'), nullable=False)
    username = db.Column(db.String(150), nullable=False)
    first_name = db.Column(db.String(150))
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())
    updated_at = db.Column(db.DateTime, default=db.func.current_timestamp(), onupdate=db.func.current_timestamp())


# Add these new models to track follows and message states
class Follow(db.Model):
    """Track which bot accounts have followed which users"""
    id = db.Column(db.Integer, primary_key=True)
    bot_account_id = db.Column(db.Integer, db.ForeignKey('bot_account.id'), nullable=False)
    target_username = db.Column(db.String(150), nullable=False)
    followed_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    follow_status = db.Column(db.String(20), default='pending')  # pending, accepted, rejected
    
    __table_args__ = (
        db.UniqueConstraint('bot_account_id', 'target_username', name='uq_follow_target'),
    )

class MessageState(db.Model):
    """Track messaging states for targets"""
    id = db.Column(db.Integer, primary_key=True)
    bot_account_id = db.Column(db.Integer, db.ForeignKey('bot_account.id'), nullable=False)
    target_username = db.Column(db.String(150), nullable=False)
    highlight_sent = db.Column(db.Boolean, default=False)
    text_message_sent = db.Column(db.Boolean, default=False)
    highlight_sent_at = db.Column(db.DateTime)
    text_message_sent_at = db.Column(db.DateTime)
    needs_text_message = db.Column(db.Boolean, default=False)  # Flag for delayed text messages
    
    __table_args__ = (
        db.UniqueConstraint('bot_account_id', 'target_username', name='uq_message_state_target'),
    )


class ScheduledAction(db.Model):
    """Track scheduled actions for bot accounts on specific dates"""
    id = db.Column(db.Integer, primary_key=True)
    bot_account_id = db.Column(db.Integer, db.ForeignKey('bot_account.id'), nullable=False)
    scheduled_date = db.Column(db.Date, nullable=False)
    action_type = db.Column(db.String(50), nullable=False)  # follows, dms, post, story, profile, name, bio
    
    # For min/max actions (follows, dms)
    min_value = db.Column(db.Integer)
    max_value = db.Column(db.Integer)
    
    # For text actions (name, bio)
    text_value = db.Column(db.Text)
    
    # For media actions (post, story, profile)
    media_file_path = db.Column(db.String(500))
    media_description = db.Column(db.Text)
    content_type = db.Column(db.String(20))  # photo, reel, video
    
    # Execution tracking
    is_executed = db.Column(db.Boolean, default=False)
    executed_at = db.Column(db.DateTime)
    execution_status = db.Column(db.String(50))  # pending, completed, failed
    error_message = db.Column(db.Text)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationship
    bot_account = db.relationship('BotAccount', backref=db.backref('scheduled_actions', lazy=True, cascade='all, delete-orphan'))
    
    def to_dict(self):
        """Convert scheduled action to dictionary"""
        data = {
            'id': self.id,
            'bot_account_id': self.bot_account_id,
            'scheduled_date': self.scheduled_date.isoformat(),
            'action_type': self.action_type,
            'is_executed': self.is_executed,
            'execution_status': self.execution_status or 'pending',
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        
        # Add type-specific fields
        if self.action_type in ['follows', 'dms']:
            data['min_value'] = self.min_value
            data['max_value'] = self.max_value
        elif self.action_type in ['name', 'bio']:
            data['text_value'] = self.text_value
        elif self.action_type in ['post', 'story', 'profile']:
            # Convert file path to web-accessible URL
            if self.media_file_path:
                import os
                filename = os.path.basename(self.media_file_path)
                data['media_file_path'] = f'/uploads/schedule_media/{filename}'
            else:
                data['media_file_path'] = None
            data['media_description'] = self.media_description
            data['content_type'] = self.content_type
            
        if self.executed_at:
            data['executed_at'] = self.executed_at.isoformat()
        if self.error_message:
            data['error_message'] = self.error_message
            
        return data


# ─── Section 05: WeeklyPlan, SessionLog, InterventionLog ──────────

class WeeklyPlan(db.Model):
    __tablename__ = 'weekly_plan'

    id = db.Column(db.Integer, primary_key=True)
    proxy_id = db.Column(db.Integer, db.ForeignKey('proxy.id'), nullable=False)
    week_number = db.Column(db.Integer, nullable=False)
    year = db.Column(db.Integer, nullable=False)
    plan_json = db.Column(db.JSON, nullable=False)
    generated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    status = db.Column(db.String(20), default='active')

    __table_args__ = (
        db.UniqueConstraint('proxy_id', 'week_number', 'year',
                           name='uq_weekly_plan_proxy_week_year'),
    )


class SessionLog(db.Model):
    __tablename__ = 'session_log'

    id = db.Column(db.Integer, primary_key=True)
    bot_account_id = db.Column(db.Integer, db.ForeignKey('bot_account.id'), nullable=False)
    session_id = db.Column(db.String(100), nullable=False)
    started_at = db.Column(db.DateTime, nullable=False)
    ended_at = db.Column(db.DateTime, nullable=True)
    session_type = db.Column(db.String(20), nullable=False)
    phase_log_json = db.Column(db.JSON, nullable=True)
    actions_json = db.Column(db.JSON, nullable=True)
    status = db.Column(db.String(20), nullable=False)
    error_message = db.Column(db.Text, nullable=True)
    post_outcome = db.Column(db.String(20), nullable=True)
    dry_run = db.Column(db.Boolean, default=False)

    __table_args__ = (
        db.Index('ix_session_log_account_date', 'bot_account_id', 'started_at'),
    )


class InterventionLog(db.Model):
    __tablename__ = 'intervention_log'

    id = db.Column(db.Integer, primary_key=True)
    bot_account_id = db.Column(db.Integer, db.ForeignKey('bot_account.id'), nullable=False)
    session_id = db.Column(db.String(100), nullable=False)
    intervention_type = db.Column(db.String(20), nullable=False)
    requested_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    resolved_at = db.Column(db.DateTime, nullable=True)
    resolution = db.Column(db.String(20), nullable=True)
    telegram_message_id = db.Column(db.Integer, nullable=True)


# ─── Section 06-01: GeminiUsage ─────────────────────────────

class GeminiUsage(db.Model):
    __tablename__ = 'gemini_usage'

    id = db.Column(db.Integer, primary_key=True)
    session_log_id = db.Column(db.Integer, db.ForeignKey('session_log.id'), nullable=True)
    call_type = db.Column(db.String(50), nullable=False)
    latency_ms = db.Column(db.Integer, nullable=False)
    success = db.Column(db.Boolean, default=True)
    estimated_cost = db.Column(db.Float, default=0.001)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.Index('ix_gemini_usage_date_type', 'created_at', 'call_type'),
    )