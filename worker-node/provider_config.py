"""Explicit, local-only provider settings; no FORMA account or cloud secrets."""
import json, os
from pathlib import Path

def read_config():
    filename=Path(os.environ.get('FORMA_CONFIG_PATH',Path(__file__).resolve().parents[1]/'forma-data/providers.json'))
    if not filename.exists():return {}
    return json.loads(filename.read_text())

def profile(provider):
    value=read_config().get(provider,{})
    if not value.get('enabled'):raise ValueError('Провайдер выключен. Настрой подключение в FORMA.')
    return value
