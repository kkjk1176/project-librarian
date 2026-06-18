from cli import SampleCli
from config import load_config


def build_commands():
    parser = SampleCli().run()
    parser.add_argument("--config", default="sample.toml")
    return parser


def inspect_config():
    return load_config()
