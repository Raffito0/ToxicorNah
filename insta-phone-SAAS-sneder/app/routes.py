from flask import Blueprint, render_template, redirect, url_for, flash, request, session, jsonify, abort, send_from_directory
from .models import db, User, StartPart, BodyPart, EndPart, Bot, BotAccount, ToMessage, Messaged, Follow, MessageState, AccountFollowers, ScheduledAction
from . import db, login_manager
from flask_login import login_user, current_user, logout_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import csv
from io import StringIO
from functools import wraps
from datetime import datetime, date, timedelta, timezone
import random
import time
import os
from sqlalchemy import func, and_, or_
auth = Blueprint('auth', __name__)

# Configuration for file uploads
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'app', 'user_data', 'uploads', 'schedule_media')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp4', 'mov', 'avi', 'webp'}
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB max file size

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS



@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def check_session(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': 'Session expired'}), 401
        return f(*args, **kwargs)
    return decorated_function

@auth.route("/signup", methods=['GET', 'POST'])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('auth.main'))
    if request.method == 'POST':
        username = request.form['username']
        email = request.form['email']
        password = request.form['password']
           
        # Check if the email already exists
        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            flash('Email address already exists', category='error')
            return redirect(url_for('auth.signup'))
        
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
        new_user = User(username=username, email=email, password=hashed_password)
        db.session.add(new_user)
        db.session.commit()
        flash('Your account has been created! You are now able to log in', 'success')
        return redirect(url_for('auth.signin'))
    return render_template('signup.html')

@auth.route("/signin", methods=['GET', 'POST'])
def signin():
    if current_user.is_authenticated:
        return redirect(url_for('auth.main'))

    errors = {}
    email = ""
    remember_me = False

    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '').strip()
        remember_me = request.form.get('rememberMe') == 'on'

        user = User.query.filter_by(email=email).first()

        if not email:
            errors['email'] = "Email is required."
        if not password:
            errors['password'] = "Password is required."

        if not errors:
            if user and check_password_hash(user.password, password):
                session.permanent = True
                login_user(user, remember=remember_me)
                flash('Login successful!', 'success')
                next_page = request.args.get('next')
                return redirect(next_page if next_page else url_for('auth.main'))
            else:
                flash('Login unsuccessful. Please check email and password', 'danger')

    return render_template(
        'signin.html',
        errors=errors,
        email=email,
        remember_me=remember_me
    )

# Add this new function to refresh session
@auth.before_request
def refresh_session():
    if current_user.is_authenticated:
        session.modified = True

@auth.route('/forgot_password', methods=['GET', 'POST'])
def forgot_password():
    errors = {}
    email = ""

    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        if not email:
            errors['email'] = "Email is required."
        else:
            # Here you would initiate the reset email process
            flash("If that email exists in our system, a reset link has been sent.", "success")
            return redirect(url_for('auth.signin'))

    return render_template('forgot_password.html', errors=errors, email=email)


@auth.route("/after-login")
@login_required
def after_login():
    return render_template('after-login.html')

@auth.route("/logout")
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('auth.signin'))


@auth.app_errorhandler(404)
def not_found(e):
    print(f"404 error: {e}")
    return render_template('not_found.html'), 404

@auth.route('/')
@login_required
def main():
    return render_template('after-login.html')

@auth.route('/phone_settings')
@login_required
def phone_settings():
    return render_template('phone-settings.html')


@auth.route('/add_part', methods=['POST'])
@login_required
def add_part():
    user_id = current_user.id
    data = request.get_json()
    part_type = data.get('partType')
    value = data.get('value')

    user = User.query.get(user_id)
    if not user:
        return jsonify(success=False, message='User not found')

    # Check if the part already exists
    if part_type == 'start':
        existing_part = StartPart.query.filter_by(content=value, user_id=user_id).first()
        if existing_part:
            flash('Start part already exists', category='error')
            return jsonify(success=False, message='Start part already exists')
        new_part = StartPart(content=value, user_id=user_id)
    elif part_type == 'body':
        existing_part = BodyPart.query.filter_by(content=value, user_id=user_id).first()
        if existing_part:
            return jsonify(success=False, message='Body part already exists')
        new_part = BodyPart(content=value, user_id=user_id)
    elif part_type == 'end':
        existing_part = EndPart.query.filter_by(content=value, user_id=user_id).first()
        if existing_part:
            return jsonify(success=False, message='End part already exists')
        new_part = EndPart(content=value, user_id=user_id)
    else:
        return jsonify(success=False, message='Invalid part type')

    db.session.add(new_part)
    db.session.commit()
    return jsonify(success=True)

@auth.route('/get_parts', methods=['GET'])
@login_required
def get_parts():
    user_id = current_user.id
    start_parts = StartPart.query.filter_by(user_id=user_id).all()
    body_parts = BodyPart.query.filter_by(user_id=user_id).all()
    end_parts = EndPart.query.filter_by(user_id=user_id).all()

    return jsonify(
        success=True,
        start=[{'id': part.id, 'content': part.content} for part in start_parts],
        body=[{'id': part.id, 'content': part.content} for part in body_parts],
        end=[{'id': part.id, 'content': part.content} for part in end_parts]
    )

@auth.route('/delete_part', methods=['POST'])
@login_required
def delete_part():
    user_id = current_user.id
    data = request.get_json()
    part_type = data.get('partType')
    part_id = data.get('partId')

    if part_type == 'start':
        part = StartPart.query.filter_by(id=part_id, user_id=user_id).first()
    elif part_type == 'body':
        part = BodyPart.query.filter_by(id=part_id, user_id=user_id).first()
    elif part_type == 'end':
        part = EndPart.query.filter_by(id=part_id, user_id=user_id).first()
    else:
        return jsonify(success=False, message='Invalid part type')

    if not part:
        return jsonify(success=False, message='Part not found')

    db.session.delete(part)
    db.session.commit()
    return jsonify(success=True)

@auth.route('/get_usernames_count', methods=['GET'])
@login_required
def get_usernames_count():
    user_id = current_user.id
    
    # Check if user has bots
    if not user_has_bots(user_id):
        return jsonify({
            'success': True, 
            'count': 0,
            'message': 'No bots found. Please create at least one bot before adding leads.'
        })
    
    # Get bot filter parameter
    bot_id_filter = request.args.get('bot_id', None)
    
    # Build query with optional bot filter
    query = ToMessage.query.filter_by(user_id=user_id)
    if bot_id_filter and bot_id_filter != 'all':
        query = query.filter_by(bot_id=bot_id_filter)
    
    count = query.count()
    return jsonify(success=True, count=count)

@auth.route('/add_usernames', methods=['POST'])
@login_required
def add_usernames():
    try:
        # Check if user has any bots
        user_bots = Bot.query.filter_by(user_id=current_user.id).all()
        if not user_bots:
            return jsonify({
                'success': False, 
                'message': 'No bots found. Please create at least one bot before adding leads.'
            }), 400
        
        if 'file' not in request.files:
            flash('No file part', 'danger')
            return jsonify(success=False, message='No file part')
        
        file = request.files['file']
        if file.filename == '':
            flash('No selected file', 'danger')
            return jsonify(success=False, message='No selected file')
        
        # Get bot selection from form data
        bot_selection = request.form.get('bot_selection', 'all')  # 'all' or specific bot_id
        target_bot_id = request.form.get('target_bot_id', None)
        
        if file and file.filename.endswith('.csv'):
            stream = StringIO(file.stream.read().decode("UTF8"), newline=None)
            csv_input = csv.reader(stream)
            rows = list(csv_input)
            
            if rows[0][0].lower() == 'username':
                rows = rows[1:]
            
            if len(rows) < 1:
                flash('CSV file must have at least 2 lines', 'danger')
                return jsonify(success=False, message='CSV file must have at least 2 lines')
            
            valid_rows = [row for row in rows if len(row) >= 2]
            
            if not valid_rows:
                flash('CSV file must contain at least one row with both username and first name', 'danger')
                return jsonify(success=False, message='CSV file must contain at least one row with both username and first name')
            
            existing_usernames = {user.username for user in ToMessage.query.filter_by(user_id=current_user.id).all()}
            
            new_users = []
            if bot_selection == 'all':
                # Distribute leads equally across all bots
                bot_count = len(user_bots)
                for i, row in enumerate(valid_rows):
                    username, first_name = row[0], row[1]
                    if username not in existing_usernames:
                        # Assign to bot in round-robin fashion
                        assigned_bot = user_bots[i % bot_count]
                        new_user = ToMessage(
                            username=username, 
                            first_name=first_name, 
                            user_id=current_user.id,
                            bot_id=assigned_bot.id
                        )
                        new_users.append(new_user)
            else:
                # Assign to specific bot
                target_bot = Bot.query.filter_by(id=target_bot_id, user_id=current_user.id).first()
                if not target_bot:
                    return jsonify({
                        'success': False, 
                        'message': 'Selected bot not found'
                    }), 400
                
                for row in valid_rows:
                    username, first_name = row[0], row[1]
                    if username not in existing_usernames:
                        new_user = ToMessage(
                            username=username, 
                            first_name=first_name, 
                            user_id=current_user.id,
                            bot_id=target_bot.id
                        )
                        new_users.append(new_user)
            
            if new_users:
                db.session.bulk_save_objects(new_users)
                db.session.commit()
                
                if bot_selection == 'all':
                    flash(f'Usernames distributed equally across {len(user_bots)} bots successfully.', 'success')
                else:
                    flash(f'Usernames added to bot "{target_bot.name}" successfully.', 'success')
            else:
                flash('No new usernames to add.', 'info')
            
            count = ToMessage.query.filter_by(user_id=current_user.id).count()
            return jsonify(success=True, count=count)
        else:
            flash('Invalid file format. Please upload a CSV file with username in the first column and name in the second column.', 'danger')
            return jsonify(success=False, message='Invalid file format. Please upload a CSV file with username in the first column and name in the second column.')
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False, 
            'message': f'An error occurred: {str(e)}'
        }), 500

# Helper function to check if user has bots
def user_has_bots(user_id):
    return Bot.query.filter_by(user_id=user_id).first() is not None

@auth.route('/get_usernames', methods=['GET'])
@login_required
@check_session
def get_usernames():
    try:
        user_id = current_user.id
        
        # Check if user has bots
        if not user_has_bots(user_id):
            return jsonify({
                'success': True,
                'usernames': [],
                'has_next': False,
                'next_page': None,
                'message': 'No bots found. Please create at least one bot before adding leads.'
            })
        
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        
        # Get bot filter parameter
        bot_id_filter = request.args.get('bot_id', None)
        
        # Build query with optional bot filter
        query = ToMessage.query.filter_by(user_id=user_id)
        if bot_id_filter and bot_id_filter != 'all':
            query = query.filter_by(bot_id=bot_id_filter)
        
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        usernames = pagination.items
        return jsonify(
            success=True,
            usernames=[{
                'id': user.id,
                'username': user.username,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'phone': user.phone,
                'bot': user.bot,
                'verified': user.verified,
                'restricted': user.restricted,
                'scam': user.scam,
                'fake': user.fake,
                'premium': user.premium,
                'access_hash': user.access_hash,
                'lang_code': user.lang_code,
                'bot_name': user.assigned_bot.name if user.assigned_bot else 'Unassigned'
            } for user in usernames],
            has_next=pagination.has_next,
            next_page=page + 1 if pagination.has_next else None
        )
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

@auth.route('/delete_username', methods=['POST'])
@login_required
def delete_username():
    user_id = current_user.id
    data = request.get_json()
    username_id = data.get('usernameId')

    username = ToMessage.query.filter_by(id=username_id, user_id=user_id).first()
    if not username:
        return jsonify(success=False, message='Username not found')

    db.session.delete(username)
    db.session.commit()
    
    # Get count based on current filter (if any)
    bot_id_filter = request.args.get('bot_id', None)
    query = ToMessage.query.filter_by(user_id=user_id)
    if bot_id_filter and bot_id_filter != 'all':
        query = query.filter_by(bot_id=bot_id_filter)
    
    count = query.count()
    return jsonify(success=True, count=count)

@auth.route('/delete_all_usernames', methods=['POST'])
@login_required
@check_session
def delete_all_usernames():
    try:
        user_id = current_user.id
        
        # Get bot filter parameter
        bot_id_filter = request.args.get('bot_id', None)
        
        # Build query with optional bot filter
        query = ToMessage.query.filter_by(user_id=user_id)
        if bot_id_filter and bot_id_filter != 'all':
            query = query.filter_by(bot_id=bot_id_filter)
        
        # Get count before deletion for response
        count_before = query.count()
        
        # Delete filtered results
        query.delete()
        db.session.commit()
        
        return jsonify(success=True, count=count_before)
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=str(e)), 500

@auth.route('/add_history_data', methods=['POST'])
@login_required
def add_history_data():
    try:
        # Check if user has any bots
        user_bots = Bot.query.filter_by(user_id=current_user.id).all()
        if not user_bots:
            return jsonify({
                'success': False, 
                'message': 'No bots found. Please create at least one bot before adding history data.'
            }), 400
        
        if 'file' not in request.files:
            flash('No file part', 'danger')
            return jsonify(success=False, message='No file part')
        
        file = request.files['file']
        if file.filename == '':
            flash('No selected file', 'danger')
            return jsonify(success=False, message='No selected file')
        
        # Get bot selection from form data
        bot_selection = request.form.get('bot_selection', 'all')  # 'all' or specific bot_id
        target_bot_id = request.form.get('target_bot_id', None)
        
        if file and file.filename.endswith('.csv'):
            stream = StringIO(file.stream.read().decode("UTF8"), newline=None)
            csv_input = csv.reader(stream)
            rows = list(csv_input)
            
            if len(rows) < 1:
                flash('CSV file must have at least 1 line', 'danger')
                return jsonify(success=False, message='CSV file must have at least 1 line')
            
            new_history = []
            if bot_selection == 'all':
                # Distribute history equally across all bots
                bot_count = len(user_bots)
                for i, row in enumerate(rows):
                    if len(row) < 1:
                        continue
                    username = row[0]
                    # Assign to bot in round-robin fashion
                    assigned_bot = user_bots[i % bot_count]
                    new_user = Messaged(
                        username=username, 
                        user_id=current_user.id,
                        bot_id=assigned_bot.id
                    )
                    new_history.append(new_user)
            else:
                # Assign to specific bot
                target_bot = Bot.query.filter_by(id=target_bot_id, user_id=current_user.id).first()
                if not target_bot:
                    return jsonify({
                        'success': False, 
                        'message': 'Selected bot not found'
                    }), 400
                
                for row in rows:
                    if len(row) < 1:
                        continue
                    username = row[0]
                    new_user = Messaged(
                        username=username, 
                        user_id=current_user.id,
                        bot_id=target_bot.id
                    )
                    new_history.append(new_user)
            
            if new_history:
                db.session.bulk_save_objects(new_history)
                db.session.commit()
                
                if bot_selection == 'all':
                    flash(f'History data distributed equally across {len(user_bots)} bots successfully.', 'success')
                else:
                    flash(f'History data added to bot "{target_bot.name}" successfully.', 'success')
            else:
                flash('No history data to add.', 'info')
            
            count = Messaged.query.filter_by(user_id=current_user.id).count()
            return jsonify(success=True, count=count)
        else:
            flash('Invalid file format. Please upload a CSV file with username in the first column.', 'danger')
            return jsonify(success=False, message='Invalid file format. Please upload a CSV file with username in the first column.')
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False, 
            'message': f'An error occurred: {str(e)}'
        }), 500

@auth.route('/get_history_data', methods=['GET'])
@login_required
def get_history_data():
    user_id = current_user.id
    
    # Check if user has bots
    if not user_has_bots(user_id):
        return jsonify({
            'success': True,
            'history_data': [],
            'has_next': False,
            'next_page': None,
            'message': 'No bots found. Please create at least one bot before adding history data.'
        })
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    
    # Get bot filter parameter
    bot_id_filter = request.args.get('bot_id', None)
    
    # Build query with optional bot filter
    query = Messaged.query.filter_by(user_id=user_id)
    if bot_id_filter and bot_id_filter != 'all':
        query = query.filter_by(bot_id=bot_id_filter)
    
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    history_data = pagination.items
    return jsonify(
        success=True,
        history_data=[{
            'id': user.id,
            'username': user.username,
            'bot_name': user.assigned_bot.name if user.assigned_bot else 'Unassigned'
        } for user in history_data],
        has_next=pagination.has_next,
        next_page=page + 1 if pagination.has_next else None
    )

@auth.route('/delete_all_history_data', methods=['POST'])
@login_required
def delete_all_history_data():
    try:
        user_id = current_user.id
        
        # Get bot filter parameter
        bot_id_filter = request.args.get('bot_id', None)
        
        # Build query with optional bot filter
        query = Messaged.query.filter_by(user_id=user_id)
        if bot_id_filter and bot_id_filter != 'all':
            query = query.filter_by(bot_id=bot_id_filter)
        
        # Get count before deletion for response
        count_before = query.count()
        
        # Delete filtered results
        query.delete()
        db.session.commit()
        
        return jsonify(success=True, count=count_before)
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=str(e)), 500

@auth.route('/delete_history_data', methods=['POST'])
@login_required
def delete_history_data():
    user_id = current_user.id
    data = request.get_json()
    history_id = data.get('historyId')

    history = Messaged.query.filter_by(id=history_id, user_id=user_id).first()
    if not history:
        return jsonify(success=False, message='History data not found')

    db.session.delete(history)
    db.session.commit()
    
    # Get count based on current filter (if any)
    bot_id_filter = request.args.get('bot_id', None)
    query = Messaged.query.filter_by(user_id=user_id)
    if bot_id_filter and bot_id_filter != 'all':
        query = query.filter_by(bot_id=bot_id_filter)
    
    count = query.count()
    return jsonify(success=True, count=count)

@auth.route('/get_history_data_count', methods=['GET'])
@login_required
def get_history_data_count():
    user_id = current_user.id
    
    # Check if user has bots
    if not user_has_bots(user_id):
        return jsonify({
            'success': True, 
            'count': 0,
            'message': 'No bots found. Please create at least one bot before adding history data.'
        })
    
    # Get bot filter parameter
    bot_id_filter = request.args.get('bot_id', None)
    
    # Build query with optional bot filter
    query = Messaged.query.filter_by(user_id=user_id)
    if bot_id_filter and bot_id_filter != 'all':
        query = query.filter_by(bot_id=bot_id_filter)
    
    count = query.count()
    return jsonify(success=True, count=count)


#  bot realated stafff  #############################################################################################
###############################################################################################
################################################################################3
#########################################################################
##########################################################


@auth.route('/api/bots', methods=['POST'])
@login_required
def create_bot():
    from sqlalchemy.exc import IntegrityError
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'phone_id' not in data:
            return jsonify({
                'success': False,
                'message': 'Phone ID is required'
            }), 400
        
        phone_id = data['phone_id'].strip()
        
        # Basic validation
        if not phone_id:
            return jsonify({
                'success': False,
                'message': 'Phone ID cannot be empty'
            }), 400
        
        # Get current user ID from session
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Check if user already has 4 bots (max limit)
        existing_bots_count = Bot.query.filter_by(user_id=user_id).count()

        # Create bot name based on phone count
        bot_name = f"Phone {existing_bots_count + 1}"
        
        # Create new bot
        new_bot = Bot(
            user_id=user_id,
            phone_id=phone_id,
            name=bot_name,
            status='stopped'
        )
        
        db.session.add(new_bot)
        db.session.commit()
        
        # Return the created bot data
        return jsonify({
            'success': True,
            'message': 'Bot created successfully',
            'bot': {
                'id': new_bot.id,
                'name': new_bot.name,
                'phone_id': new_bot.phone_id,
                'status': new_bot.status,
                'accounts_count': 0  # New bot has no accounts yet
            }
        }), 201
        
    except IntegrityError as e:
        db.session.rollback()
        error_message = str(e.orig)
        
        if 'uq_user_phone' in error_message:
            return jsonify({
                'success': False,
                'message': 'Phone ID already exists for this user'
            }), 409
        elif 'uq_user_port' in error_message:
            return jsonify({
                'success': False,
                'message': 'Appium Port already exists for this user'
            }), 409
        else:
            return jsonify({
                'success': False,
                'message': 'Database constraint violation'
            }), 409
            
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'An error occurred while creating the bot'
        }), 500

@auth.route('/api/bots', methods=['GET'])
@login_required
def get_bots():
    try:
        # Get current user ID from session
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Get all bots for the user
        bots = Bot.query.filter_by(user_id=user_id).all()
        
        bots_data = []
        for bot in bots:
            # Count accounts for this bot (adjust query based on your BotAccount model)
            accounts_count = len(bot.accounts) if bot.accounts else 0
            
            bots_data.append({
                'id': bot.id,
                'name': bot.name,
                'phone_id': bot.phone_id,
                'status': bot.status,
                'platform': bot.platform or 'instagram',
                'control_status': bot.control_status or 'stopped',
                'accounts_count': accounts_count
            })
        
        return jsonify({
            'success': True,
            'bots': bots_data
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': 'An error occurred while fetching bots'
        }), 500

@auth.route('/api/bots/<int:bot_id>/toggle', methods=['POST'])
@login_required
def toggle_bot_status(bot_id):
    import threading
    from .logic import worker
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        bot_id=bot.id
        # Toggle status — dispatch by platform
        if bot.platform == 'tiktok':
            # TikTok: non-blocking worker thread
            from .tiktok_worker import tiktok_worker, get_worker_status
            if bot.control_status in ('stopped', 'error'):
                # Guard: reject if already running
                if bot.control_status == 'running':
                    return jsonify(success=False, error='Bot is already running'), 409
                bot.should_stop = False
                db.session.commit()
                t = threading.Thread(target=tiktok_worker, args=(bot_id, user_id), daemon=True)
                t.start()
                return jsonify(success=True, new_status='active',
                               control_status='running',
                               message=f'TikTok bot {bot.name} starting'), 200
            else:
                # Stop
                bot.should_stop = True
                bot.control_status = 'stopping'
                db.session.commit()
                return jsonify(success=True, new_status='stopped',
                               control_status='stopping',
                               message=f'TikTok bot {bot.name} stopping'), 200
        else:
            # Instagram: existing blocking worker (unchanged)
            if bot.status == 'stopped':
                bot.status = 'active'
                bot.should_stop = False
                db.session.commit()
                time.sleep(5)
                t1 = threading.Thread(target=worker, args=(bot_id, user_id))
                t1.start()
                time.sleep(5)
                t1.join()
            else:
                bot.status = 'stopped'
                bot.should_stop = True
                db.session.commit()

            db.session.commit()
            return jsonify(success=True, new_status=bot.status,
                           message=f'Bot {bot.name} status updated to {bot.status}'), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'An error occurred while updating bot status'
        }), 500



@auth.route('/api/bots/<int:bot_id>/start-forever', methods=['POST'])
@login_required
def start_forever(bot_id):
    """Start bot in 24/7 always-on mode."""
    import threading
    try:
        user_id = current_user.id
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify(success=False, error='Bot not found'), 404
        if bot.control_status == 'running':
            return jsonify(success=False, error='Bot is already running'), 409

        bot.always_on = True
        bot.should_stop = False
        db.session.commit()

        from .control import write_control
        write_control({'action': 'run'})

        from .tiktok_worker import tiktok_worker
        t = threading.Thread(target=tiktok_worker, args=(bot_id, user_id), daemon=True)
        t.start()

        return jsonify(success=True, control_status='running'), 200
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, error=str(e)[:100]), 500


@auth.route('/api/bots/<int:bot_id>/stop-graceful', methods=['POST'])
@login_required
def stop_graceful(bot_id):
    """Stop bot gracefully — finish current session, then exit."""
    try:
        user_id = current_user.id
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify(success=False, error='Bot not found'), 404

        bot.should_stop = True
        bot.control_status = 'stopping'
        db.session.commit()

        from .control import write_control
        write_control({'action': 'stop'})

        return jsonify(success=True, control_status='stopping'), 200
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, error=str(e)[:100]), 500


@auth.route('/api/bots/<int:bot_id>/dry-run', methods=['PUT'])
@login_required
def toggle_dry_run(bot_id):
    """Toggle dry-run mode for a bot."""
    try:
        user_id = current_user.id
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify(success=False, error='Bot not found'), 404

        data = request.get_json()
        enabled = data.get('enabled', False) if data else False
        bot.dry_run = enabled
        db.session.commit()

        from .control import write_control
        write_control({'action': 'dry_run', 'enabled': enabled})

        return jsonify(success=True, dry_run=enabled), 200
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, error=str(e)[:100]), 500


@auth.route('/api/bots/<int:bot_id>/status', methods=['GET'])
@login_required
def get_bot_status(bot_id):
    """Return live session status for a running TikTok bot."""
    try:
        user_id = current_user.id
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify(success=False, message='Bot not found'), 404

        from .tiktok_worker import get_worker_status
        live_status = get_worker_status(bot_id)

        result = {
            'control_status': bot.control_status or 'stopped',
            'platform': bot.platform or 'instagram',
            'current_session': None,
            'error': None,
        }

        if live_status:
            result['current_session'] = {
                'account': live_status.get('account', ''),
                'phase': live_status.get('phase', ''),
                'elapsed_seconds': live_status.get('elapsed_seconds', 0),
                'actions': live_status.get('actions', {}),
            }
            if live_status.get('error'):
                result['error'] = live_status['error']

        return jsonify(result), 200

    except Exception as e:
        return jsonify(success=False, message='Error fetching status'), 500


@auth.route('/api/bots/<int:bot_id>', methods=['GET'])
@login_required
def get_bot_settings(bot_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        # Convert bot settings to dictionary
        bot_settings = {
            'id': bot.id,
            'name': bot.name,
            'phone_id': bot.phone_id,
            'status': bot.status,
            'accounts_count': len(bot.accounts) if bot.accounts else 0,
            
            # Scheduling settings
            'start_exec_from': bot.start_exec_from.strftime('%H:%M') if bot.start_exec_from else '06:30',
            'start_exec_to': bot.start_exec_to.strftime('%H:%M') if bot.start_exec_to else '07:00',
            'stop_exec_from': bot.stop_exec_from.strftime('%H:%M') if bot.stop_exec_from else '14:00',
            'stop_exec_to': bot.stop_exec_to.strftime('%H:%M') if bot.stop_exec_to else '15:00',
            
            # Wait times
            'same_account_wait_min': bot.same_account_wait_min or 5,
            'same_account_wait_max': bot.same_account_wait_max or 7,
            'diff_account_wait_min': bot.diff_account_wait_min or 25,
            'diff_account_wait_max': bot.diff_account_wait_max or 40,
            
            # Sessions
            'sessions_per_account_min': bot.sessions_per_account_min or 2,
            'sessions_per_account_max': bot.sessions_per_account_max or 2,
            'session_duration_min': bot.session_duration_min or 80,
            'session_duration_max': bot.session_duration_max or 120,
            
            # Pauses
            'pause_during_session_min': bot.pause_during_session_min or 6,
            'pause_during_session_max': bot.pause_during_session_max or 11,
            'pause_probability_min': bot.pause_probability_min or 90,
            'pause_probability_max': bot.pause_probability_max or 100,
            'pauses_per_session_min': bot.pauses_per_session_min or 2,
            'pauses_per_session_max': bot.pauses_per_session_max or 4,
            
            # Browse settings
            'browse_ig_start_min': bot.browse_ig_start_min or 63,
            'browse_ig_start_max': bot.browse_ig_start_max or 124,
            'browse_ig_action_min': bot.browse_ig_action_min or 90,
            'browse_ig_action_max': bot.browse_ig_action_max or 120,
            'browse_ig_action_probability_min': bot.browse_ig_action_probability_min or 60,
            'browse_ig_action_probability_max': bot.browse_ig_action_probability_max or 80,
            
            # Typing
            'typing_speed_min': bot.typing_speed_min or 2,
            'typing_speed_max': bot.typing_speed_max or 5,
        }
        
        return jsonify({
            'success': True,
            'bot': bot_settings
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': 'An error occurred while fetching bot settings'
        }), 500

@auth.route('/api/bots/<int:bot_id>', methods=['PUT'])
@login_required
def update_bot_settings(bot_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided'
            }), 400
        
        # Update bot settings
        from datetime import datetime
        
        # Parse time strings
        if 'start_exec_from' in data:
            bot.start_exec_from = datetime.strptime(data['start_exec_from'], '%H:%M').time()
        if 'start_exec_to' in data:
            bot.start_exec_to = datetime.strptime(data['start_exec_to'], '%H:%M').time()
        if 'stop_exec_from' in data:
            bot.stop_exec_from = datetime.strptime(data['stop_exec_from'], '%H:%M').time()
        if 'stop_exec_to' in data:
            bot.stop_exec_to = datetime.strptime(data['stop_exec_to'], '%H:%M').time()
        
        # Update integer fields
        integer_fields = [
            'same_account_wait_min', 'same_account_wait_max',
            'diff_account_wait_min', 'diff_account_wait_max',
            'sessions_per_account_min', 'sessions_per_account_max',
            'session_duration_min', 'session_duration_max',
            'pause_during_session_min', 'pause_during_session_max',
            'pause_probability_min', 'pause_probability_max',
            'pauses_per_session_min', 'pauses_per_session_max',
            'browse_ig_start_min', 'browse_ig_start_max',
            'browse_ig_action_min', 'browse_ig_action_max',
            'browse_ig_action_probability_min', 'browse_ig_action_probability_max',
            'typing_speed_min', 'typing_speed_max'
        ]
        
        for field in integer_fields:
            if field in data:
                setattr(bot, field, int(data[field]))
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Bot settings updated successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'An error occurred while updating bot settings'
        }), 500

@auth.route('/api/bots/<int:bot_id>', methods=['DELETE'])
@login_required
def delete_bot(bot_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
       
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
       
        bot_name = bot.name
       
        # The cascade='all, delete-orphan' in Bot relationships will automatically delete:
        # - All BotAccount records
        # - All ToMessage records assigned to this bot
        # - All Messaged records assigned to this bot
        # 
        # And the cascade in BotAccount relationships will also delete:
        # - All AccountFollowers records for each bot account
        # - All Follow records for each bot account
        # - All MessageState records for each bot account
        db.session.delete(bot)
        db.session.commit()
       
        return jsonify({
            'success': True,
            'message': f'Bot {bot_name} and all related data deleted successfully'
        }), 200
       
    except Exception as e:
        db.session.rollback()
        print(f"Error deleting bot: {str(e)}")  # For debugging
        return jsonify({
            'success': False,
            'message': 'An error occurred while deleting the bot'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts', methods=['GET'])
@login_required
def get_bot_accounts(bot_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Verify bot belongs to current user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        # Get all accounts for this bot
        accounts = BotAccount.query.filter_by(bot_id=bot_id).all()
        
        accounts_data = []
        for account in accounts:
            acct_data = {
                'id': account.id,
                'clone_id': account.clone_id,
                'username': account.username,
                'status': account.status,
                'platform': account.platform or 'instagram',
                'daily_messages_sent': account.dms_done_today or 0,
                'total_messages_sent': account.total_messages_sent or 0,
                'last_message_time': account.last_dm_time.isoformat() if account.last_dm_time else None,
            }
            # TikTok-specific fields
            if account.platform == 'tiktok':
                acct_data['warmup_completed'] = account.warmup_completed
                if account.warmup_json:
                    acct_data['warmup_day'] = account.warmup_json.get('current_day', 0)
                    acct_data['warmup_total_days'] = account.warmup_json.get('total_days', 7)
                if account.personality_json:
                    acct_data['personality'] = {
                        k: v for k, v in account.personality_json.items()
                        if k in ('reels_preference', 'story_affinity', 'double_tap_habit',
                                'explore_curiosity', 'boredom_rate', 'boredom_relief',
                                'switch_threshold')
                    }
                if account.niche_json:
                    acct_data['niche_description'] = account.niche_json.get('description', '')
                    acct_data['niche_keywords_count'] = len(account.niche_json.get('keywords', []))
            accounts_data.append(acct_data)
        
        return jsonify({
            'success': True,
            'accounts': accounts_data
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': 'An error occurred while fetching bot accounts'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts', methods=['POST'])
@login_required
def add_bot_account(bot_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Verify bot belongs to current user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided'
            }), 400
        
        clone_id = data.get('clone_id', '').strip()
        if not clone_id:
            return jsonify({
                'success': False,
                'message': 'Clone ID is required'
            }), 400
        
        # Check if account with this clone_id already exists for this bot
        existing_account = BotAccount.query.filter_by(
            bot_id=bot_id, 
            clone_id=clone_id
        ).first()
        
        if existing_account:
            return jsonify({
                'success': False,
                'message': 'Account with this clone ID already exists'
            }), 409
        
        # Create new account
        new_account = BotAccount(
            bot_id=bot_id,
            clone_id=clone_id,
            username=data.get('username', ''),
            password=data.get('password', ''),
            status='active',
            dms_done_today=0,
            total_messages_sent=0,
        )
        
        db.session.add(new_account)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Account added successfully',
            'account': {
                'id': new_account.id,
                'clone_id': new_account.clone_id,
                'username': new_account.username,
                'status': new_account.status,
                'daily_messages_sent': new_account.dms_done_today,
                'total_messages_sent': new_account.total_messages_sent,
                'last_message_time': None,
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'An error occurred while adding the account'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>', methods=['PUT'])
@login_required
def update_bot_account(bot_id, account_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Verify bot belongs to current user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        # Get the account
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({
                'success': False,
                'message': 'Account not found'
            }), 404
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided'
            }), 400
        
        # Update account fields
        if 'username' in data:
            account.username = data['username'].strip()
        if 'password' in data:
            account.password = data['password']
        if 'status' in data:
            account.status = data['status']
        if 'clone_id' in data:
            clone_id = data['clone_id'].strip()
            if clone_id:
                # Check if another account with this clone_id already exists
                existing_account = BotAccount.query.filter_by(
                    bot_id=bot_id, 
                    clone_id=clone_id
                ).filter(BotAccount.id != account_id).first()
                
                if existing_account:
                    return jsonify({
                        'success': False,
                        'message': 'Account with this clone ID already exists'
                    }), 409
                
                account.clone_id = clone_id
        
        account.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Account updated successfully',
            'account': {
                'id': account.id,
                'clone_id': account.clone_id,
                'username': account.username,
                'status': account.status,
                'daily_messages_sent': account.dms_done_today,
                'total_messages_sent': account.total_messages_sent,
                'last_message_time': account.last_dm_time.isoformat() if account.last_dm_time else None,
             
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'An error occurred while updating the account'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>', methods=['DELETE'])
@login_required
def delete_bot_account(bot_id, account_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Verify bot belongs to current user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        # Get the account
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({
                'success': False,
                'message': 'Account not found'
            }), 404
        
        clone_id = account.clone_id
        
        # The cascade='all, delete-orphan' in the BotAccount relationships will automatically:
        # - Delete all AccountFollowers records
        # - Delete all Follow records
        # - Delete all MessageState records
        db.session.delete(account)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Account {clone_id} and all related data deleted successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        print(f"Error deleting bot account: {str(e)}")  # For debugging
        return jsonify({
            'success': False,
            'message': 'An error occurred while deleting the account'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>/settings', methods=['GET'])
@login_required
def get_account_settings(bot_id, account_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Verify bot belongs to current user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        # Get the account
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({
                'success': False,
                'message': 'Account not found'
            }), 404
        
        # Convert account settings to dictionary
        account_settings = {
            'id': account.id,
            'clone_id': account.clone_id,
            'username': account.username,
            'status': account.status,
            'daily_messages_sent': account.dms_done_today or 0,
            'total_messages_sent': account.total_messages_sent or 0,
            'last_message_time': account.last_dm_time.isoformat() if account.last_dm_time else None,
            
            # Follow settings (allow 0 values)
            'follow_per_session_min': account.follow_per_session_min if account.follow_per_session_min is not None else 10,
            'follow_per_session_max': account.follow_per_session_max if account.follow_per_session_max is not None else 14,
            'follow_per_hour_min': account.follow_per_hour_min if account.follow_per_hour_min is not None else 5,
            'follow_per_hour_max': account.follow_per_hour_max if account.follow_per_hour_max is not None else 7,
            'follow_per_day_min': account.follow_per_day_min if account.follow_per_day_min is not None else 20,
            'follow_per_day_max': account.follow_per_day_max if account.follow_per_day_max is not None else 30,
            'follow_delay_min': account.follow_delay_min if account.follow_delay_min is not None else 90,
            'follow_delay_max': account.follow_delay_max if account.follow_delay_max is not None else 130,
            
            # Likes settings (allow 0 values)
            'likes_per_session_min': account.likes_per_session_min if account.likes_per_session_min is not None else 10,
            'likes_per_session_max': account.likes_per_session_max if account.likes_per_session_max is not None else 14,
            'likes_per_hour_min': account.likes_per_hour_min if account.likes_per_hour_min is not None else 5,
            'likes_per_hour_max': account.likes_per_hour_max if account.likes_per_hour_max is not None else 7,
            'likes_per_day_min': account.likes_per_day_min if account.likes_per_day_min is not None else 20,
            'likes_per_day_max': account.likes_per_day_max if account.likes_per_day_max is not None else 30,
            'likes_per_target_profile_min': account.likes_per_target_profile_min if account.likes_per_target_profile_min is not None else 0,
            'likes_per_target_profile_max': account.likes_per_target_profile_max if account.likes_per_target_profile_max is not None else 3,
            'liking_target_profile_posts_probability_min': account.liking_target_profile_posts_probability_min if account.liking_target_profile_posts_probability_min is not None else 80,
            'liking_target_profile_posts_probability_max': account.liking_target_profile_posts_probability_max if account.liking_target_profile_posts_probability_max is not None else 90,
            'delay_between_target_profile_posts_likes_min': account.delay_between_target_profile_posts_likes_min if account.delay_between_target_profile_posts_likes_min is not None else 40,
            'delay_between_target_profile_posts_likes_max': account.delay_between_target_profile_posts_likes_max if account.delay_between_target_profile_posts_likes_max is not None else 70,
            
            # DMs settings (allow 0 values)
            'dms_per_session_min': account.dms_per_session_min if account.dms_per_session_min is not None else 10,
            'dms_per_session_max': account.dms_per_session_max if account.dms_per_session_max is not None else 14,
            'dms_per_hour_min': account.dms_per_hour_min if account.dms_per_hour_min is not None else 5,
            'dms_per_hour_max': account.dms_per_hour_max if account.dms_per_hour_max is not None else 7,
            'dms_per_day_min': account.dms_per_day_min if account.dms_per_day_min is not None else 20,
            'dms_per_day_max': account.dms_per_day_max if account.dms_per_day_max is not None else 30,
            'dms_delay_min': account.dms_delay_min if account.dms_delay_min is not None else 60,
            'dms_delay_max': account.dms_delay_max if account.dms_delay_max is not None else 90,
            'dm_only_followers': account.dm_only_followers,
            'profile_to_take_highlight_from': account.profile_to_take_highlight_from or '',
            'highlight_number': account.highlight_number if account.highlight_number is not None else 1,
            'changehighlightnumber': account.changehighlightnumber,
            'text_dm_sent_probability_min': account.text_dm_sent_probability_min if account.text_dm_sent_probability_min is not None else 70,
            'text_dm_sent_probability_max': account.text_dm_sent_probability_max if account.text_dm_sent_probability_max is not None else 80,
            'long_term_delay_highlight_text_dm_min': account.long_term_delay_highlight_text_dm_min if account.long_term_delay_highlight_text_dm_min is not None else 5,
            'long_term_delay_highlight_text_dm_max': account.long_term_delay_highlight_text_dm_max if account.long_term_delay_highlight_text_dm_max is not None else 24,
            'short_term_delay_probability_min': account.short_term_delay_probability_min if account.short_term_delay_probability_min is not None else 40,
            'short_term_delay_probability_max': account.short_term_delay_probability_max if account.short_term_delay_probability_max is not None else 50,
            'short_term_delay_highlight_text_dm_min': account.short_term_delay_highlight_text_dm_min if account.short_term_delay_highlight_text_dm_min is not None else 60,
            'short_term_delay_highlight_text_dm_max': account.short_term_delay_highlight_text_dm_max if account.short_term_delay_highlight_text_dm_max is not None else 100,
            'long_term_delay_probability_min': account.long_term_delay_probability_min if account.long_term_delay_probability_min is not None else 50,
            'long_term_delay_probability_max': account.long_term_delay_probability_max if account.long_term_delay_probability_max is not None else 60,
            
            # Browse IG Actions (allow 0 values)
            'watch_stories_probability_min': account.watch_stories_probability_min if account.watch_stories_probability_min is not None else 70,
            'watch_stories_probability_max': account.watch_stories_probability_max if account.watch_stories_probability_max is not None else 80,
            'watch_reels_probability_min': account.watch_reels_probability_min if account.watch_reels_probability_min is not None else 80,
            'watch_reels_probability_max': account.watch_reels_probability_max if account.watch_reels_probability_max is not None else 90,
            'scroll_feed_probability_min': account.scroll_feed_probability_min if account.scroll_feed_probability_min is not None else 90,
            'scroll_feed_probability_max': account.scroll_feed_probability_max if account.scroll_feed_probability_max is not None else 100,
            'scroll_explore_page_probability_min': account.scroll_explore_page_probability_min if account.scroll_explore_page_probability_min is not None else 70,
            'scroll_explore_page_probability_max': account.scroll_explore_page_probability_max if account.scroll_explore_page_probability_max is not None else 80,
            'like_probability_during_browse_min': account.like_probability_during_browse_min if account.like_probability_during_browse_min is not None else 60,
            'like_probability_during_browse_max': account.like_probability_during_browse_max if account.like_probability_during_browse_max is not None else 70,
        }
        
        return jsonify({
            'success': True,
            'account_settings': account_settings
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': 'An error occurred while fetching account settings'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>/settings', methods=['PUT'])
@login_required
def update_account_settings(bot_id, account_id):
    try:
        user_id = current_user.id
        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Verify bot belongs to current user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({
                'success': False,
                'message': 'Bot not found'
            }), 404
        
        # Get the account
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({
                'success': False,
                'message': 'Account not found'
            }), 404
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided'
            }), 400
        
        # Update integer fields
        integer_fields = [
            'follow_per_session_min', 'follow_per_session_max',
            'follow_per_hour_min', 'follow_per_hour_max',
            'follow_per_day_min', 'follow_per_day_max',
            'follow_delay_min', 'follow_delay_max',
            'likes_per_session_min', 'likes_per_session_max',
            'likes_per_hour_min', 'likes_per_hour_max',
            'likes_per_day_min', 'likes_per_day_max',
            'likes_per_target_profile_min', 'likes_per_target_profile_max',
            'liking_target_profile_posts_probability_min', 'liking_target_profile_posts_probability_max',
            'delay_between_target_profile_posts_likes_min', 'delay_between_target_profile_posts_likes_max',
            'dms_per_session_min', 'dms_per_session_max',
            'dms_per_hour_min', 'dms_per_hour_max',
            'dms_per_day_min', 'dms_per_day_max',
            'dms_delay_min', 'dms_delay_max',
            'highlight_number',
            'text_dm_sent_probability_min', 'text_dm_sent_probability_max',
            'long_term_delay_highlight_text_dm_min', 'long_term_delay_highlight_text_dm_max',
            'short_term_delay_probability_min', 'short_term_delay_probability_max',
            'short_term_delay_highlight_text_dm_min', 'short_term_delay_highlight_text_dm_max',
            'long_term_delay_probability_min', 'long_term_delay_probability_max',
            'watch_stories_probability_min', 'watch_stories_probability_max',
            'watch_reels_probability_min', 'watch_reels_probability_max',
            'scroll_feed_probability_min', 'scroll_feed_probability_max',
            'scroll_explore_page_probability_min', 'scroll_explore_page_probability_max',
            'like_probability_during_browse_min', 'like_probability_during_browse_max'
        ]
        
        for field in integer_fields:
            if field in data:
                setattr(account, field, int(data[field]))
        
        # Update string fields
        if 'profile_to_take_highlight_from' in data:
            account.profile_to_take_highlight_from = data['profile_to_take_highlight_from']
        
        # Update boolean fields
        if 'dm_only_followers' in data:
            account.dm_only_followers = bool(data['dm_only_followers'])
        
        if 'changehighlightnumber' in data:
            account.changehighlightnumber = bool(data['changehighlightnumber'])
        
        account.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Account settings updated successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'An error occurred while updating account settings'
        }), 500

@auth.route('/get_user_bots', methods=['GET'])
@login_required
def get_user_bots():
    try:
        user_id = current_user.id
        bots = Bot.query.filter_by(user_id=user_id).all()
        
        bots_data = []
        for bot in bots:
            bots_data.append({
                'id': bot.id,
                'name': bot.name,
                'phone_id': bot.phone_id,
                'status': bot.status
            })
        
        return jsonify({
            'success': True,
            'bots': bots_data
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': 'An error occurred while fetching bots'
        }), 500


# ========== CALENDAR SCHEDULE API ROUTES ==========

@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>/schedule', methods=['GET'])
@login_required
@check_session
def get_account_schedule(bot_id, account_id):
    """Get all scheduled actions for an account"""
    try:
        user_id = current_user.id
        
        # Verify bot belongs to user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({'success': False, 'message': 'Bot not found'}), 404
        
        # Verify account belongs to bot
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({'success': False, 'message': 'Account not found'}), 404
        
        # Get date range from query params (optional)
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        query = ScheduledAction.query.filter_by(bot_account_id=account_id)
        
        if start_date:
            query = query.filter(ScheduledAction.scheduled_date >= datetime.strptime(start_date, '%Y-%m-%d').date())
        if end_date:
            query = query.filter(ScheduledAction.scheduled_date <= datetime.strptime(end_date, '%Y-%m-%d').date())
        
        actions = query.order_by(ScheduledAction.scheduled_date).all()
        
        # Group actions by date
        actions_by_date = {}
        for action in actions:
            date_key = action.scheduled_date.isoformat()
            if date_key not in actions_by_date:
                actions_by_date[date_key] = []
            actions_by_date[date_key].append(action.to_dict())
        
        return jsonify({
            'success': True,
            'schedule': actions_by_date
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error fetching schedule: {str(e)}'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>/schedule', methods=['POST'])
@login_required
@check_session
def create_scheduled_action(bot_id, account_id):
    """Create a new scheduled action"""
    try:
        user_id = current_user.id
        
        # Verify bot belongs to user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({'success': False, 'message': 'Bot not found'}), 404
        
        # Verify account belongs to bot
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({'success': False, 'message': 'Account not found'}), 404
        
        # Check if this is a file upload request
        if 'file' in request.files:
            # Handle media upload
            file = request.files['file']
            if file and allowed_file(file.filename):
                # Create upload directory if it doesn't exist
                os.makedirs(UPLOAD_FOLDER, exist_ok=True)
                
                # Generate unique filename
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = secure_filename(file.filename)
                name, ext = os.path.splitext(filename)
                unique_filename = f"{account_id}_{timestamp}_{name}{ext}"
                file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
                
                # Save file
                file.save(file_path)
                
                # Get form data
                scheduled_date = datetime.strptime(request.form.get('scheduled_date'), '%Y-%m-%d').date()
                action_type = request.form.get('action_type')
                content_type = request.form.get('content_type', 'photo')
                description = request.form.get('description', '')
                
                # Create scheduled action (store absolute path for consistency)
                action = ScheduledAction(
                    bot_account_id=account_id,
                    scheduled_date=scheduled_date,
                    action_type=action_type,
                    media_file_path=file_path,
                    media_description=description,
                    content_type=content_type,
                    execution_status='pending'
                )
                
                db.session.add(action)
                db.session.commit()
                
                return jsonify({
                    'success': True,
                    'message': 'Scheduled action created successfully',
                    'action': action.to_dict()
                }), 201
            else:
                return jsonify({'success': False, 'message': 'Invalid file type'}), 400
        else:
            # Handle JSON data (for non-media actions)
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'message': 'No data provided'}), 400
            
            # Validate required fields
            if 'scheduled_date' not in data or 'action_type' not in data:
                return jsonify({'success': False, 'message': 'Missing required fields'}), 400
            
            scheduled_date = datetime.strptime(data['scheduled_date'], '%Y-%m-%d').date()
            action_type = data['action_type']
            
            # Create scheduled action
            action = ScheduledAction(
                bot_account_id=account_id,
                scheduled_date=scheduled_date,
                action_type=action_type,
                execution_status='pending'
            )
            
            # Set type-specific fields
            if action_type in ['follows', 'dms']:
                action.min_value = data.get('min_value')
                action.max_value = data.get('max_value')
            elif action_type in ['name', 'bio']:
                action.text_value = data.get('text_value')
            
            db.session.add(action)
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Scheduled action created successfully',
                'action': action.to_dict()
            }), 201
            
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error creating scheduled action: {str(e)}'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>/schedule/<int:action_id>', methods=['PUT'])
@login_required
@check_session
def update_scheduled_action(bot_id, account_id, action_id):
    """Update a scheduled action"""
    try:
        user_id = current_user.id
        
        # Verify bot belongs to user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({'success': False, 'message': 'Bot not found'}), 404
        
        # Verify account belongs to bot
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({'success': False, 'message': 'Account not found'}), 404
        
        # Get the scheduled action
        action = ScheduledAction.query.filter_by(id=action_id, bot_account_id=account_id).first()
        if not action:
            return jsonify({'success': False, 'message': 'Scheduled action not found'}), 404
        
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'message': 'No data provided'}), 400
        
        # Update fields
        if 'scheduled_date' in data:
            action.scheduled_date = datetime.strptime(data['scheduled_date'], '%Y-%m-%d').date()
        
        if 'min_value' in data:
            action.min_value = data['min_value']
        if 'max_value' in data:
            action.max_value = data['max_value']
        if 'text_value' in data:
            action.text_value = data['text_value']
        if 'media_description' in data:
            action.media_description = data['media_description']
        if 'content_type' in data:
            action.content_type = data['content_type']
        
        action.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Scheduled action updated successfully',
            'action': action.to_dict()
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error updating scheduled action: {str(e)}'
        }), 500


@auth.route('/api/bots/<int:bot_id>/accounts/<int:account_id>/schedule/<int:action_id>', methods=['DELETE'])
@login_required
@check_session
def delete_scheduled_action(bot_id, account_id, action_id):
    """Delete a scheduled action"""
    try:
        user_id = current_user.id
        
        # Verify bot belongs to user
        bot = Bot.query.filter_by(id=bot_id, user_id=user_id).first()
        if not bot:
            return jsonify({'success': False, 'message': 'Bot not found'}), 404
        
        # Verify account belongs to bot
        account = BotAccount.query.filter_by(id=account_id, bot_id=bot_id).first()
        if not account:
            return jsonify({'success': False, 'message': 'Account not found'}), 404
        
        # Get the scheduled action
        action = ScheduledAction.query.filter_by(id=action_id, bot_account_id=account_id).first()
        if not action:
            return jsonify({'success': False, 'message': 'Scheduled action not found'}), 404
        
        # Delete associated file if it exists
        if action.media_file_path:
            # Handle both absolute and relative paths for backwards compatibility
            if os.path.isabs(action.media_file_path):
                file_path = action.media_file_path
            else:
                # Legacy relative path support
                file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'app', 'static', action.media_file_path)
            
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass  # File deletion is not critical
        
        db.session.delete(action)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Scheduled action deleted successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error deleting scheduled action: {str(e)}'
        }), 500


@auth.route('/uploads/schedule_media/<filename>')
@login_required
def serve_schedule_media(filename):
    """Serve uploaded schedule media files"""
    try:
        return send_from_directory(UPLOAD_FOLDER, filename)
    except FileNotFoundError:
        abort(404)