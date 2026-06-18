from src.output import render_output


def test_render_output():
    assert render_output() == "sample:json"
