"""CLI for the Video Delivery Bridge.

Usage:
    python -m delivery.cli status --phone 2
    python -m delivery.cli status --all
    python -m delivery.cli deliver --phone 2 --platform tiktok
    python -m delivery.cli deliver --phone 2 --platform tiktok --dry-run
"""
import argparse
import sys

from .content_library import get_next_video, get_pending_count
from .downloader import download_video
from .adb_push import push_to_phone
from .status import mark_posted


def cmd_status(args):
    """Show pending video counts."""
    phones = [args.phone] if args.phone else [1, 2, 3]

    for phone in phones:
        tk = get_pending_count(phone, "tiktok")
        ig = get_pending_count(phone, "instagram")
        print(f"Phone {phone}: TikTok={tk} pending, Instagram={ig} pending")


def cmd_deliver(args):
    """Deliver next pending video to a phone."""
    video = get_next_video(args.phone, args.platform)

    if not video:
        print(f"No pending videos for Phone {args.phone} / {args.platform}")
        return

    print(f"Video: {video['scenario_name']}")
    print(f"Caption: {video['caption'][:80]}..." if len(video.get("caption", "")) > 80 else f"Caption: {video.get('caption', 'N/A')}")
    print(f"URL: {video['video_url']}")

    if args.dry_run:
        print("[DRY RUN] Would download + push + mark posted")
        return

    print("Downloading...")
    local = download_video(video["video_url"])
    print(f"Downloaded to: {local}")

    print(f"Pushing to Phone {args.phone}...")
    remote = push_to_phone(args.phone, local)
    print(f"Pushed to: {remote}")

    mark_posted(video["record_id"], args.platform)
    print(f"Marked as posted ({args.platform})")


def main():
    parser = argparse.ArgumentParser(description="Video Delivery Bridge")
    sub = parser.add_subparsers(dest="command")

    # status
    p_status = sub.add_parser("status", help="Show pending video counts")
    p_status.add_argument("--phone", type=int, choices=[1, 2, 3])
    p_status.add_argument("--all", action="store_true")

    # deliver
    p_deliver = sub.add_parser("deliver", help="Deliver next video to phone")
    p_deliver.add_argument("--phone", type=int, required=True, choices=[1, 2, 3])
    p_deliver.add_argument("--platform", required=True, choices=["tiktok", "instagram"])
    p_deliver.add_argument("--dry-run", action="store_true", help="Show what would happen without doing it")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "status":
        cmd_status(args)
    elif args.command == "deliver":
        cmd_deliver(args)


if __name__ == "__main__":
    main()
