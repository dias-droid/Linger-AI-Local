"""Resume the saved BYOK gateway with the verified localmodels kit."""

import json
import sys

from localmodels import (
    bifrost_config,
    bifrost_datasheet,
    gateway_bifrost,
    hosts,
    library_gateway,
    source_byok,
)
from localmodels.__main__ import main


def restore_saved_gateway() -> bool:
    """Return False if the kit needs to apply the saved source again."""
    with library_gateway.gateway_locked():
        source = source_byok.load_source_state()
        if not source or source["mode"] != "byok":
            return True
        record = library_gateway.ensure_instance(None)
        if not record or source["gateway_url"] != "http://" + record["addr"]:
            return False
        addr = record["addr"]
        gateway_bifrost.require_target(
            {"tools_dir": hosts.tools_dir(), "tools": [{"tool": "gateway", "path": addr}]}
        )
        app = gateway_bifrost.app_dir()
        config = bifrost_config.read_config(app)
        if not config:
            return False
        creds = source_byok.load_credentials()
        if not creds:
            raise source_byok.ByokError("BYOK_INVALID_CONFIG", "Saved BYOK credentials are missing.")

        provider = source_byok.BYOK_PROVIDER
        model = creds["model_id"]
        config.setdefault("providers", {})[provider] = source_byok.render_byok_provider(creds)
        governance = config.setdefault("governance", {})
        rules = governance.get("routing_rules") or []
        governance["routing_rules"] = [
            rule for rule in rules if rule.get("id") != bifrost_config.BYOK_RULE
        ] + [bifrost_config.byok_rule(model)]
        sheet = {
            name: row for name, row in library_gateway.read_sheet(app).items()
            if not name.startswith(f"{provider}/")
        }
        byok_sheets = bifrost_datasheet.sheets(
            provider, [model, source_byok.BYOK_MODEL], creds["context_window"]
        )
        sheet.update(byok_sheets[bifrost_datasheet.DATASHEET])

        # apply_config waits for local health. The setup-only /v1/models check
        # can block on a provider that accepts connections before it is ready.
        library_gateway.apply_config(record, config, sheet)
        source_byok.write_byok_profiles(addr, creds)
        return True


if __name__ == "__main__":
    try:
        restored = restore_saved_gateway()
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"code": getattr(error, "code", "BYOK_GATEWAY_FAILED"), "message": str(error)}))
        sys.exit(1)
    sys.exit(0 if restored else main())
