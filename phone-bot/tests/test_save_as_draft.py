"""Tests for save_as_draft() presence and signature in TikTokBot and InstagramBot.

Uses source code inspection (AST) to verify the methods exist and follow
the correct pattern, without importing the heavy bot modules.
"""
import ast
from pathlib import Path

import pytest

PHONE_BOT_DIR = Path(__file__).parent.parent
TIKTOK_PATH = PHONE_BOT_DIR / "actions" / "tiktok.py"
INSTAGRAM_PATH = PHONE_BOT_DIR / "actions" / "instagram.py"


def _get_method_node(filepath: Path, class_name: str, method_name: str):
    """Find an AST method definition inside a class."""
    source = filepath.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name == method_name:
                    return item
    return None


def _get_source_segment(filepath: Path, method_name: str) -> str:
    """Get source lines for a method (rough: from def to next def or class)."""
    lines = filepath.read_text(encoding="utf-8").splitlines()
    in_method = False
    method_lines = []
    indent = 0
    for line in lines:
        if f"def {method_name}" in line:
            in_method = True
            indent = len(line) - len(line.lstrip())
            method_lines.append(line)
            continue
        if in_method:
            if line.strip() and not line.startswith(" " * (indent + 1)) and not line.strip().startswith("#"):
                if line.strip().startswith("def ") or line.strip().startswith("class "):
                    break
            method_lines.append(line)
    return "\n".join(method_lines)


class TestTikTokSaveAsDraft:

    def test_save_as_draft_method_exists(self):
        """TikTokBot must have a save_as_draft method."""
        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "save_as_draft")
        assert node is not None, "TikTokBot.save_as_draft() not found in tiktok.py"

    def test_save_as_draft_returns_bool(self):
        """save_as_draft must have -> bool return annotation."""
        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "save_as_draft")
        assert node is not None
        assert node.returns is not None
        ret = ast.dump(node.returns)
        assert "bool" in ret, f"Return annotation is not bool: {ret}"

    def test_save_as_draft_has_video_path_and_caption_params(self):
        """save_as_draft must accept (self, video_path, caption)."""
        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "save_as_draft")
        assert node is not None
        arg_names = [a.arg for a in node.args.args]
        assert "self" in arg_names
        assert "video_path" in arg_names
        assert "caption" in arg_names

    def test_save_as_draft_pushes_video(self):
        """save_as_draft source must contain push_file call."""
        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
        assert "push_file" in src, "save_as_draft must push video to device"

    def test_save_as_draft_uses_draft_button(self):
        """save_as_draft source must tap upload_save_draft_btn (not upload_post_btn)."""
        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
        assert "upload_save_draft_btn" in src, "Must tap the draft button"
        assert "upload_post_btn" not in src, "Must NOT tap the post button"

    def test_save_as_draft_deletes_video(self):
        """save_as_draft must delete video from device after success."""
        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
        assert 'rm "' in src or "rm '" in src, "Must delete video file after draft save"

    def test_save_as_draft_verifies_app(self):
        """save_as_draft must verify current app after draft save."""
        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
        assert "get_current_app" in src, "Must verify app is still TikTok after draft"


class TestInstagramSaveAsDraft:

    def test_save_as_draft_method_exists(self):
        """InstagramBot must have a save_as_draft method."""
        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "save_as_draft")
        assert node is not None, "InstagramBot.save_as_draft() not found in instagram.py"

    def test_save_as_draft_returns_bool(self):
        """save_as_draft must have -> bool return annotation."""
        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "save_as_draft")
        assert node is not None
        assert node.returns is not None
        ret = ast.dump(node.returns)
        assert "bool" in ret, f"Return annotation is not bool: {ret}"

    def test_save_as_draft_has_video_path_and_caption_params(self):
        """save_as_draft must accept (self, video_path, caption)."""
        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "save_as_draft")
        assert node is not None
        arg_names = [a.arg for a in node.args.args]
        assert "self" in arg_names
        assert "video_path" in arg_names
        assert "caption" in arg_names

    def test_save_as_draft_uses_back_button(self):
        """Instagram draft uses Back to trigger 'Save Draft' dialog."""
        src = _get_source_segment(INSTAGRAM_PATH, "save_as_draft")
        assert "press_back" in src, "Instagram draft must use press_back to trigger save dialog"

    def test_save_as_draft_taps_confirm(self):
        """Instagram draft must tap save_draft_confirm in dialog."""
        src = _get_source_segment(INSTAGRAM_PATH, "save_as_draft")
        assert "save_draft_confirm" in src, "Must tap save_draft_confirm button"


class TestPostVideoReturnType:
    """Verify post_video/post_reel return string codes, not booleans."""

    def test_tiktok_post_video_returns_str(self):
        """post_video must have -> str return annotation."""
        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "post_video")
        assert node is not None
        assert node.returns is not None
        ret = ast.dump(node.returns)
        assert "str" in ret, f"post_video return type should be str, got: {ret}"

    def test_tiktok_post_video_no_bare_true_return(self):
        """post_video must not return bare True/False."""
        src = _get_source_segment(TIKTOK_PATH, "post_video")
        assert "return True" not in src, "post_video must return string codes, not True"
        assert "return False" not in src, "post_video must return string codes, not False"

    def test_tiktok_post_video_returns_success_string(self):
        """post_video must return 'success' on success path."""
        src = _get_source_segment(TIKTOK_PATH, "post_video")
        assert '"success"' in src, "post_video must return 'success' string"

    def test_instagram_post_reel_returns_str(self):
        """post_reel must have -> str return annotation."""
        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "post_reel")
        assert node is not None
        assert node.returns is not None
        ret = ast.dump(node.returns)
        assert "str" in ret, f"post_reel return type should be str, got: {ret}"

    def test_instagram_post_reel_returns_success_string(self):
        """post_reel must return 'success' on success path."""
        src = _get_source_segment(INSTAGRAM_PATH, "post_reel")
        assert '"success"' in src, "post_reel must return 'success' string"
