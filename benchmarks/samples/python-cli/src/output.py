from commands import inspect_config


def render_output():
    config = inspect_config()
    return f"{config['profile']}:{config['output']}"
