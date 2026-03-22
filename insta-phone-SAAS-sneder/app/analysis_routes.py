from flask import Blueprint, render_template, redirect, url_for, flash, request, session, jsonify, abort
from .models import db, User, StartPart, BodyPart, EndPart, Bot, BotAccount, ToMessage, Messaged, Follow, MessageState, AccountFollowers, SessionLog, GeminiUsage
from flask_login import login_user, current_user, logout_user, login_required
from datetime import datetime, date, timedelta
from sqlalchemy import func, and_, or_, text
from collections import defaultdict

analysis = Blueprint('analysis', __name__)

@analysis.route('/analysis')
@login_required
def analysis_page():
    return render_template('analysis.html')

@analysis.route('/api/analysis/dashboard', methods=['GET'])
@login_required
def get_analysis_dashboard():
    try:
        user_id = current_user.id
        
        # Get time filter parameter (default to last 7 days)
        days = request.args.get('days', 7, type=int)
        start_date = datetime.now() - timedelta(days=days)
        
        # Get bot filter parameter  
        bot_id_filter = request.args.get('bot_id', None)
        
        # Build base queries with user filter
        bots_query = Bot.query.filter_by(user_id=user_id)
        accounts_query = db.session.query(BotAccount).join(Bot).filter(Bot.user_id == user_id)
        
        # Apply bot filter if specified
        if bot_id_filter and bot_id_filter != 'all':
            bots_query = bots_query.filter_by(id=bot_id_filter)
            accounts_query = accounts_query.filter(Bot.id == bot_id_filter)
        
        # Get basic counts
        total_bots = bots_query.count()
        total_accounts = accounts_query.count()
        active_bots = bots_query.filter_by(status='active').count()
        
        # Get account status distribution
        account_status_counts = (
            accounts_query
            .with_entities(BotAccount.status, func.count(BotAccount.id))
            .group_by(BotAccount.status)
            .all()
        )
        
        # Get leads and messaged counts
        leads_query = ToMessage.query.filter_by(user_id=user_id)
        messaged_query = Messaged.query.filter_by(user_id=user_id)
        
        if bot_id_filter and bot_id_filter != 'all':
            leads_query = leads_query.filter_by(bot_id=bot_id_filter)
            messaged_query = messaged_query.filter_by(bot_id=bot_id_filter)
        
        total_leads = leads_query.count()
        total_messaged = messaged_query.count()
        
        # Debug: Print leads and messaged info
        # print(f"Debug: Leads: {total_leads}, Total Messaged: {total_messaged}")
        
        # Get messaging activity over time (last N days)
        daily_activity = []
        for i in range(days):
            day = datetime.now().date() - timedelta(days=i)
            
            # Messages sent that day - count both highlights and text messages from MessageState
            # Count highlights sent on this day
            highlights_query = (
                db.session.query(MessageState)
                .join(BotAccount)
                .join(Bot)
                .filter(Bot.user_id == user_id)
                .filter(MessageState.highlight_sent == True)
                .filter(func.date(MessageState.highlight_sent_at) == day)
            )
            
            # Count text messages sent on this day  
            text_messages_query = (
                db.session.query(MessageState)
                .join(BotAccount)
                .join(Bot)
                .filter(Bot.user_id == user_id)
                .filter(MessageState.text_message_sent == True)
                .filter(func.date(MessageState.text_message_sent_at) == day)
            )
            
            if bot_id_filter and bot_id_filter != 'all':
                highlights_query = highlights_query.filter(Bot.id == bot_id_filter)
                text_messages_query = text_messages_query.filter(Bot.id == bot_id_filter)
            
            highlights_sent_today = highlights_query.count()
            text_messages_sent_today = text_messages_query.count()
            
            # Total messages = highlights + text messages
            messages_sent = highlights_sent_today + text_messages_sent_today
            
            # Follows that day
            follows_query = (
                db.session.query(Follow)
                .join(BotAccount)
                .join(Bot)
                .filter(Bot.user_id == user_id)
                .filter(func.date(Follow.followed_at) == day)
            )
            
            if bot_id_filter and bot_id_filter != 'all':
                follows_query = follows_query.filter(Bot.id == bot_id_filter)
            
            follows_count = follows_query.count()
            
            # Debug: Print daily activity for today
            # if day == datetime.now().date():
                # print(f"Debug: Today ({day}) - Highlights: {highlights_sent_today}, Text Messages: {text_messages_sent_today}, Total Messages: {messages_sent}, Follows: {follows_count}")
            
            daily_activity.append({
                'date': day.strftime('%Y-%m-%d'),
                'messages': int(messages_sent),
                'highlights': int(highlights_sent_today),
                'text_messages': int(text_messages_sent_today),
                'follows': follows_count
            })
        
        # Reverse to show oldest to newest
        daily_activity.reverse()
        
        # Get top performing accounts (show all accounts)
        # Debug: Let's see all accounts for this user
        all_user_accounts = BotAccount.query.join(Bot).filter(Bot.user_id == user_id).all()
        # print(f"Debug: Found {len(all_user_accounts)} accounts for user {user_id}")
        for acc in all_user_accounts:
            print(f"  Account: {acc.username}, Bot: {acc.bot.name}, Messages: {acc.total_messages_sent}, Daily: {acc.dms_done_today}")
        
        top_accounts = (
            accounts_query
            .order_by(BotAccount.total_messages_sent.desc().nullslast())
            .limit(10)
            .all()
        )
        
        top_accounts_data = []
        for account in top_accounts:
            top_accounts_data.append({
                'username': account.username,
                'bot_name': account.bot.name,
                'total_messages': account.total_messages_sent,
                'daily_messages': account.dms_done_today,
                'status': account.status,
                'last_active': account.last_dm_time.strftime('%Y-%m-%d %H:%M') if account.last_dm_time else 'Never'
            })
        
        # Get follow success rates
        follow_stats = {}
        if bot_id_filter and bot_id_filter != 'all':
            follow_query = (
                db.session.query(Follow)
                .join(BotAccount)
                .join(Bot)
                .filter(Bot.user_id == user_id, Bot.id == bot_id_filter)
            )
        else:
            follow_query = (
                db.session.query(Follow)
                .join(BotAccount)
                .join(Bot)
                .filter(Bot.user_id == user_id)
            )
        
        total_follows = follow_query.count()
        accepted_follows = follow_query.filter(Follow.follow_status == 'accepted').count()
        pending_follows = follow_query.filter(Follow.follow_status == 'pending').count()
        rejected_follows = follow_query.filter(Follow.follow_status == 'rejected').count()
        
        follow_stats = {
            'total': total_follows,
            'accepted': accepted_follows,
            'pending': pending_follows,
            'rejected': rejected_follows,
            'success_rate': round((accepted_follows / total_follows * 100) if total_follows > 0 else 0, 1)
        }
        
        # Get message state statistics using MessageState for accurate tracking
        message_states_query = (
            db.session.query(MessageState)
            .join(BotAccount)
            .join(Bot)
            .filter(Bot.user_id == user_id)
        )
        
        if bot_id_filter and bot_id_filter != 'all':
            message_states_query = message_states_query.filter(Bot.id == bot_id_filter)
        
        # Get highlights sent (from MessageState)
        highlights_sent = message_states_query.filter(MessageState.highlight_sent == True).count()
        
        # Get text messages sent (from MessageState)
        text_messages_sent = message_states_query.filter(MessageState.text_message_sent == True).count()
        
        # Get pending text messages (highlights sent but text message not sent yet and needed)
        pending_text_messages = message_states_query.filter(
            and_(MessageState.highlight_sent == True, 
                 MessageState.text_message_sent == False,
                 MessageState.needs_text_message == True)
        ).count()
        
        # Debug: Print message state info
        total_message_states = message_states_query.count()
        # print(f"Debug: Message States - Total: {total_message_states}, Highlights: {highlights_sent}, Text Messages: {text_messages_sent}, Pending: {pending_text_messages}")
        
        message_stats = {
            'highlights_sent': highlights_sent,
            'text_messages_sent': text_messages_sent,
            'pending_text_messages': pending_text_messages,
            'conversion_rate': round((text_messages_sent / highlights_sent * 100) if highlights_sent > 0 else 0, 1)
        }
        
        # Get bot performance comparison
        bot_performance = []
        for bot in Bot.query.filter_by(user_id=user_id).all():
            bot_accounts = BotAccount.query.filter_by(bot_id=bot.id).all()
            total_messages = sum(acc.total_messages_sent or 0 for acc in bot_accounts)
            active_accounts = len([acc for acc in bot_accounts if acc.status == 'active'])
            
            bot_performance.append({
                'bot_name': bot.name,
                'status': bot.status,
                'accounts_count': len(bot_accounts),
                'active_accounts': active_accounts,
                'total_messages': total_messages,
                'leads_count': ToMessage.query.filter_by(bot_id=bot.id).count()
            })
        
        return jsonify({
            'success': True,
            'data': {
                'overview': {
                    'total_bots': total_bots,
                    'active_bots': active_bots,
                    'total_accounts': total_accounts,
                    'total_leads': total_leads,
                    'total_messaged': total_messaged,
                    'total_highlights': highlights_sent,
                    'total_text_messages': text_messages_sent
                },
                'account_status_distribution': dict(account_status_counts),
                'daily_activity': daily_activity,
                'top_accounts': top_accounts_data,
                'follow_stats': follow_stats,
                'message_stats': message_stats,
                'bot_performance': bot_performance
            }
        }), 200
        
    except Exception as e:
        print(f"Analysis dashboard error: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'An error occurred while fetching analysis data'
        }), 500


# ─── TikTok Analytics (section-02 of 06-analytics) ──────────

SCORE_BINS = [(0, 20), (21, 40), (41, 60), (61, 80), (81, 100)]


@analysis.route('/api/analysis/tiktok', methods=['GET'])
@login_required
def get_tiktok_analytics():
    try:
        user_id = current_user.id
        days = request.args.get('days', 7, type=int)
        bot_id_filter = request.args.get('bot_id', None)
        start_date = datetime.now(tz=None) - timedelta(days=days)

        # Base query: SessionLog → BotAccount → Bot (user-scoped)
        base_q = (db.session.query(SessionLog)
                  .join(BotAccount, SessionLog.bot_account_id == BotAccount.id)
                  .join(Bot, BotAccount.bot_id == Bot.id)
                  .filter(Bot.user_id == user_id,
                          SessionLog.started_at >= start_date))
        if bot_id_filter and bot_id_filter != 'all':
            base_q = base_q.filter(Bot.id == int(bot_id_filter))

        sessions = base_q.all()

        # ── daily_engagement (json_extract via SQL) ──
        engagement_sql = text("""
            SELECT date(sl.started_at) as day,
                   COALESCE(SUM(json_extract(sl.actions_json, '$.likes')), 0) as likes,
                   COALESCE(SUM(json_extract(sl.actions_json, '$.comments')), 0) as comments,
                   COALESCE(SUM(json_extract(sl.actions_json, '$.follows')), 0) as follows,
                   COALESCE(SUM(json_extract(sl.actions_json, '$.profile_visits')), 0) as profile_visits,
                   COALESCE(SUM(json_extract(sl.actions_json, '$.searches')), 0) as searches
            FROM session_log sl
            JOIN bot_account ba ON sl.bot_account_id = ba.id
            JOIN bot b ON ba.bot_id = b.id
            WHERE b.user_id = :user_id AND sl.started_at >= :start_date
            GROUP BY day ORDER BY day
        """)
        eng_rows = db.session.execute(engagement_sql,
                                       {'user_id': user_id, 'start_date': start_date}).fetchall()
        daily_engagement = [
            {'date': r[0], 'likes': int(r[1] or 0), 'comments': int(r[2] or 0),
             'follows': int(r[3] or 0), 'profile_visits': int(r[4] or 0),
             'searches': int(r[5] or 0)}
            for r in eng_rows
        ]

        # ── videos_posted ──
        vp_map = defaultdict(lambda: {'posted': 0, 'draft': 0, 'skipped': 0})
        for s in sessions:
            if s.post_outcome:
                ba = db.session.get(BotAccount, s.bot_account_id)
                bot = db.session.get(Bot, ba.bot_id) if ba else None
                day = s.started_at.strftime('%Y-%m-%d')
                key = (day, bot.phone_id if bot else '?', bot.platform if bot else '?')
                outcome = s.post_outcome
                if outcome in vp_map[key]:
                    vp_map[key][outcome] += 1
        videos_posted = [
            {'date': k[0], 'phone_id': k[1], 'platform': k[2], **v}
            for k, v in sorted(vp_map.items())
        ]

        # ── phase_distribution ──
        phase_acc = defaultdict(lambda: defaultdict(float))
        for s in sessions:
            if s.phase_log_json and isinstance(s.phase_log_json, list):
                ba = db.session.get(BotAccount, s.bot_account_id)
                acct_name = ba.username if ba else 'unknown'
                for entry in s.phase_log_json:
                    phase = entry.get('phase', 'unknown')
                    dur_sec = entry.get('duration_sec', 0)
                    phase_acc[acct_name][f'{phase}_min'] += dur_sec / 60.0
        phase_distribution = [
            {'account': acct, **{k: round(v, 1) for k, v in phases.items()}}
            for acct, phases in phase_acc.items()
        ]

        # ── follow_back_stats ──
        total_evaluated = 0
        total_followed = 0
        scores_followed = []
        scores_skipped = []
        score_hist = {f'{lo}-{hi}': 0 for lo, hi in SCORE_BINS}
        for s in sessions:
            if s.actions_json and isinstance(s.actions_json, dict):
                fbs = s.actions_json.get('follow_backs', [])
                for fb in fbs:
                    total_evaluated += 1
                    score = fb.get('score', 0)
                    for lo, hi in SCORE_BINS:
                        if lo <= score <= hi:
                            score_hist[f'{lo}-{hi}'] += 1
                            break
                    if fb.get('followed'):
                        total_followed += 1
                        scores_followed.append(score)
                    else:
                        scores_skipped.append(score)

        follow_back_stats = {
            'total_evaluated': total_evaluated,
            'total_followed': total_followed,
            'avg_score_followed': round(sum(scores_followed) / len(scores_followed), 1) if scores_followed else 0,
            'avg_score_skipped': round(sum(scores_skipped) / len(scores_skipped), 1) if scores_skipped else 0,
            'score_distribution': [{'range': k, 'count': v} for k, v in score_hist.items()],
        }

        return jsonify({
            'daily_engagement': daily_engagement,
            'videos_posted': videos_posted,
            'phase_distribution': phase_distribution,
            'follow_back_stats': follow_back_stats,
        })

    except Exception as e:
        print(f"TikTok analytics error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@analysis.route('/api/analysis/gemini', methods=['GET'])
@login_required
def get_gemini_analytics():
    try:
        days = request.args.get('days', 7, type=int)
        start_date = datetime.now(tz=None) - timedelta(days=days)

        # daily_calls
        daily_q = (db.session.query(
            func.date(GeminiUsage.created_at).label('day'),
            func.count().label('calls'),
            func.sum(db.case((GeminiUsage.success == False, 1), else_=0)).label('errors'),
            func.sum(GeminiUsage.estimated_cost).label('cost'),
        ).filter(GeminiUsage.created_at >= start_date)
         .group_by('day').order_by('day'))

        daily_calls = [
            {'date': str(r.day), 'calls': r.calls,
             'errors': int(r.errors or 0), 'cost': round(float(r.cost or 0), 4)}
            for r in daily_q.all()
        ]

        # by_type
        type_q = (db.session.query(
            GeminiUsage.call_type,
            func.count().label('count'),
            func.avg(GeminiUsage.latency_ms).label('avg_lat'),
            func.sum(db.case((GeminiUsage.success == False, 1), else_=0)).label('errors'),
        ).filter(GeminiUsage.created_at >= start_date)
         .group_by(GeminiUsage.call_type))

        by_type = []
        for r in type_q.all():
            by_type.append({
                'type': r.call_type,
                'count': r.count,
                'avg_latency_ms': round(float(r.avg_lat or 0)),
                'error_rate': round(int(r.errors or 0) / r.count, 3) if r.count else 0,
            })

        total_cost = sum(d['cost'] for d in daily_calls)

        return jsonify({
            'daily_calls': daily_calls,
            'by_type': by_type,
            'total_cost': round(total_cost, 4),
        })

    except Exception as e:
        print(f"Gemini analytics error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
