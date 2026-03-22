"""Entry point for the Weekly & Daily Plan Generator.

Usage:
    python -m planner.main --weekly                    # Generate plan for current week
    python -m planner.main --weekly --date 2026-03-02  # Generate plan for week of Mar 2
    python -m planner.main --daily                     # Generate plan for today
    python -m planner.main --daily --date 2026-03-02   # Generate plan for specific day
"""
import argparse
import sys
from datetime import date, datetime

from .scheduler import generate_weekly_plan
from .formatter import save_weekly_json, save_weekly_text, save_daily_json, save_daily_text
from .personality import get_account_state
from . import config


def main():
    parser = argparse.ArgumentParser(
        description="Generate Weekly & Daily Plans for TikTok/Instagram accounts"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--weekly", action="store_true", help="Generate a weekly plan (Mon-Sun)")
    group.add_argument("--daily", action="store_true", help="Generate a daily plan")
    parser.add_argument("--date", type=str, default=None,
                        help="Target date in YYYY-MM-DD format (default: today)")

    args = parser.parse_args()

    target_date = date.today()
    if args.date:
        try:
            target_date = date.fromisoformat(args.date)
        except ValueError:
            print(f"Error: invalid date format '{args.date}'. Use YYYY-MM-DD.")
            sys.exit(1)

    if args.weekly:
        print(f"Generating weekly plan for week of {target_date.isoformat()}...")
        plan = generate_weekly_plan(accounts=config.ACCOUNTS, start_date=target_date)

        json_path = save_weekly_json(plan)
        txt_path = save_weekly_text(plan)

        print(f"\nWeekly Plan — Week {plan.week_number}, {plan.year}")
        print(f"  Period: {plan.start_date} to {plan.end_date}")
        print(f"\n  JSON: {json_path}")
        print(f"  TXT:  {txt_path}")

        # Print quick summary
        print(f"\n--- Quick Summary ---")
        for name, summary in sorted(plan.account_summaries.items()):
            print(f"  {name}: {summary.total_posts} posts, {summary.total_sessions} sessions")

    elif args.daily:
        print(f"Generating daily plan for {target_date.isoformat()}...")
        # Generate the weekly plan to get assignments, then extract the daily plan
        plan = generate_weekly_plan(accounts=config.ACCOUNTS, start_date=target_date)

        if target_date in plan.daily_plans:
            daily = plan.daily_plans[target_date]
        else:
            print(f"Error: {target_date} not found in generated weekly plan.")
            sys.exit(1)

        json_path = save_daily_json(daily)
        txt_path = save_daily_text(daily)

        print(f"\n  JSON: {json_path}")
        print(f"  TXT:  {txt_path}")
        print(f"\n  Sessions: {len(daily.sessions)}")
        print(f"  Proxy rotations: {len(daily.proxy_rotations)}")


if __name__ == "__main__":
    main()
