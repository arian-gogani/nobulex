"""Tests for the framework example scripts."""
import subprocess
import sys
import os

import pytest

EXAMPLES_DIR = os.path.join(os.path.dirname(__file__), "examples")


def run_example(name):
    """Run an example script and return (returncode, stdout, stderr)."""
    env = os.environ.copy()
    env["PYTHONPATH"] = os.path.dirname(__file__)
    result = subprocess.run(
        [sys.executable, os.path.join(EXAMPLES_DIR, name)],
        capture_output=True, text=True, env=env, timeout=30
    )
    return result


def test_pydantic_ai_example():
    r = run_example("pydantic_ai_receipts.py")
    assert r.returncode == 0, r.stderr
    assert "verdict=ALLOW" in r.stdout
    assert "verdict=DENY" in r.stdout
    assert "signature_valid=True" in r.stdout
    assert "Trust score" in r.stdout


def test_crewai_example():
    r = run_example("crewai_receipts.py")
    assert r.returncode == 0, r.stderr
    assert "researcher" in r.stdout
    assert "deployer" in r.stdout
    assert "Trust scores" in r.stdout


def test_langchain_example():
    r = run_example("langchain_receipts.py")
    assert r.returncode == 0, r.stderr
    assert "search" in r.stdout
    assert "web_scrape" in r.stdout
    assert "Trust score" in r.stdout


def test_google_adk_example():
    r = run_example("google_adk_receipts.py")
    assert r.returncode == 0, r.stderr
    assert "google_search" in r.stdout
    assert "send_email" in r.stdout
    assert "Chain verified: True" in r.stdout


def test_haystack_example():
    r = run_example("haystack_receipts.py")
    assert r.returncode == 0, r.stderr
    assert "text_embedder" in r.stdout
    assert "llm_generator" in r.stdout
    assert "Chain verified: True" in r.stdout


def test_llamaindex_example():
    r = run_example("llamaindex_receipts.py")
    assert r.returncode == 0, r.stderr
    assert "vector_search" in r.stdout
    assert "sql_query" in r.stdout
    assert "Chain verified: True" in r.stdout
