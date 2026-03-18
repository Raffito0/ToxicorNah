"""Test configuration: make phone-bot relative imports work in pytest.

phone-bot modules use relative imports (e.g., core/adb.py does `from .. import config`).
When pytest runs from phone-bot/, we need a fake parent package so these resolve.
"""
import sys
import os
import types

# phone-bot directory
phone_bot_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if phone_bot_dir not in sys.path:
    sys.path.insert(0, phone_bot_dir)

# Create a fake parent package so `from .. import config` in core/adb.py works.
# We register phone-bot/ as package "phone_bot" with core/ as sub-package.
_PKG = "phone_bot"
if _PKG not in sys.modules:
    # Import config as a standalone module first
    import importlib.util
    config_path = os.path.join(phone_bot_dir, "config.py")
    spec = importlib.util.spec_from_file_location("config", config_path)
    config_mod = importlib.util.module_from_spec(spec)
    sys.modules["config"] = config_mod
    spec.loader.exec_module(config_mod)

    # Create parent package
    parent = types.ModuleType(_PKG)
    parent.__path__ = [phone_bot_dir]
    parent.__package__ = _PKG
    parent.__file__ = os.path.join(phone_bot_dir, "__init__.py")
    sys.modules[_PKG] = parent

    # Alias config under parent
    sys.modules[f"{_PKG}.config"] = config_mod
    parent.config = config_mod

    # Register core as sub-package of parent
    core_dir = os.path.join(phone_bot_dir, "core")
    core_pkg = types.ModuleType(f"{_PKG}.core")
    core_pkg.__path__ = [core_dir]
    core_pkg.__package__ = f"{_PKG}.core"
    core_pkg.__file__ = os.path.join(core_dir, "__init__.py")
    sys.modules[f"{_PKG}.core"] = core_pkg

    # Now import core.adb through the package so relative imports work
    adb_path = os.path.join(core_dir, "adb.py")
    adb_spec = importlib.util.spec_from_file_location(
        f"{_PKG}.core.adb", adb_path,
        submodule_search_locations=[]
    )
    adb_mod = importlib.util.module_from_spec(adb_spec)
    adb_mod.__package__ = f"{_PKG}.core"
    sys.modules[f"{_PKG}.core.adb"] = adb_mod

    # Also register under the short name tests use
    sys.modules["core.adb"] = adb_mod
    sys.modules["core"] = core_pkg

    # Now execute adb.py — relative imports will resolve via sys.modules
    try:
        adb_spec.loader.exec_module(adb_mod)
    except ImportError as e:
        # PIL or coords may not be importable in test env.
        # The parse functions and DeviceConfigError are already defined
        # before the failing import, so they're available on adb_mod.
        import warnings
        warnings.warn(f"adb.py partial import (some deps missing): {e}")

    # Register core.proxy module
    proxy_path = os.path.join(core_dir, "proxy.py")
    if os.path.exists(proxy_path):
        proxy_spec = importlib.util.spec_from_file_location(
            f"{_PKG}.core.proxy", proxy_path,
            submodule_search_locations=[]
        )
        proxy_mod = importlib.util.module_from_spec(proxy_spec)
        proxy_mod.__package__ = f"{_PKG}.core"
        sys.modules[f"{_PKG}.core.proxy"] = proxy_mod
        sys.modules["core.proxy"] = proxy_mod
        try:
            proxy_spec.loader.exec_module(proxy_mod)
        except ImportError as e:
            import warnings
            warnings.warn(f"proxy.py partial import: {e}")

    # Register core.monitor module
    monitor_path = os.path.join(core_dir, "monitor.py")
    if os.path.exists(monitor_path):
        monitor_spec = importlib.util.spec_from_file_location(
            f"{_PKG}.core.monitor", monitor_path,
            submodule_search_locations=[]
        )
        monitor_mod = importlib.util.module_from_spec(monitor_spec)
        monitor_mod.__package__ = f"{_PKG}.core"
        sys.modules[f"{_PKG}.core.monitor"] = monitor_mod
        sys.modules["core.monitor"] = monitor_mod
        try:
            monitor_spec.loader.exec_module(monitor_mod)
        except ImportError as e:
            import warnings
            warnings.warn(f"monitor.py partial import: {e}")

    # Register main_discovery module (uses absolute imports, works via sys.path)
    discovery_path = os.path.join(phone_bot_dir, "main_discovery.py")
    if os.path.exists(discovery_path):
        disc_spec = importlib.util.spec_from_file_location("main_discovery", discovery_path)
        disc_mod = importlib.util.module_from_spec(disc_spec)
        sys.modules["main_discovery"] = disc_mod
        try:
            disc_spec.loader.exec_module(disc_mod)
        except ImportError as e:
            import warnings
            warnings.warn(f"main_discovery.py partial import: {e}")
