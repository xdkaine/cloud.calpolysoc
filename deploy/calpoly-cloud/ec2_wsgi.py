#!/usr/bin/env python3

import importlib.util
from pathlib import Path

APP_PATH = Path(__file__).with_name("ec2-api.py")

spec = importlib.util.spec_from_file_location("calpoly_ec2_api", APP_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.init_database()

app = module.app
