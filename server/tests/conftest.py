import pytest
from hearth import config
from hearth.db import DB


@pytest.fixture
def cfg():
    return config.parse({
        "owner": "me@github",
        "service": [
            {"unit": "valheim", "name": "Valheim", "group": "Games", "actions": "full"},
            {"unit": "ssh", "name": "SSH", "group": "Network"},
        ],
        "game": [{"id": "vh", "kind": "valheim", "name": "World", "unit": "valheim", "address": "{public_ip}:2456"}],
    })


@pytest.fixture
def db():
    return DB(":memory:")
