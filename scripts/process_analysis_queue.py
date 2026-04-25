#!/usr/bin/env python3
"""
Phase 6 signal intelligence processor.
Reads pending jobs from /home/ubuntu/s2/data/analysis_queue/,
renders 1H candlestick charts, runs vision analysis via Claude Code CLI,
writes results to signal_analysis table in S2 SQLite DB.
"""

import os
import sys
import json
import sqlite3
import subprocess
import traceback
from pathlib import Path
from datetime import datetime

# Set non-interactive backend before any matplotlib import
import matplotlib
matplotlib.use('Agg')

QUEUE_DIR = Path('/home/ubuntu/s2/data/analysis_queue')
CHART_DIR = Path('/home/ubuntu/s2/data/charts')
DB_PATH = os.environ.get('S2_DB_PATH', '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite')


def ensure_db_table(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS signal_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id TEXT NOT NULL UNIQUE,
            bot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            s6_directive TEXT,
            conviction_score INTEGER,
            analysis_text TEXT,
            chart_image_path TEXT,
            processed_at TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


def render_chart(candles, job_id, side, symbol):
    import pandas as pd
    import mplfinance as mpf

    CHART_DIR.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(candles)
    df['datetime'] = pd.to_datetime(df['t'], unit='ms', utc=True)
    df = df.set_index('datetime')
    df = df.rename(columns={'o': 'Open', 'h': 'High', 'l': 'Low', 'c': 'Close', 'v': 'Volume'})

    direction = 'LONG' if side == 'Buy' else 'SHORT'
    chart_path = CHART_DIR / f'{job_id}.png'

    mpf.plot(
        df,
        type='candle',
        style='charles',
        title=f'{symbol} 1H — {direction}',
        ylabel='Price',
        volume=True,
        figsize=(16, 10),
        savefig=str(chart_path),
    )
    return chart_path


def run_vision_analysis(chart_path, side, entry_price, symbol):
    """Invoke claude -p with Read tool to analyse the chart image. No API key required."""
    direction = 'LONG' if side == 'Buy' else 'SHORT'
    prompt = (
        f'Read the candlestick chart image at {chart_path}. '
        f'A {direction} trade was just entered on {symbol} at {entry_price}. '
        f'Analyse the chart technically. Output JSON only — no markdown, no explanation:\n'
        f'{{"directive":"TRADE","conviction":4,"analysis":"your assessment here"}}\n\n'
        f'directive must be exactly one of:\n'
        f'TRADE — momentum and trend align with the entry direction, clear setup\n'
        f'WAIT — setup developing but needs more candle confirmation\n'
        f'AVOID — counter-trend, exhaustion, or structurally weak entry\n'
        f'MONITOR — neutral/unclear, watch next few candles before sizing up\n'
        f'conviction is an integer 1 (low) to 5 (high). analysis is 2-3 sentences.'
    )

    result = subprocess.run(
        ['claude', '-p', prompt, '--allowedTools', 'Read', '--output-format', 'json'],
        capture_output=True,
        text=True,
        timeout=90,
    )

    if result.returncode != 0:
        raise RuntimeError(f'claude exited {result.returncode}: {result.stderr[:300]}')

    # claude --output-format json wraps output in {"result": "...", ...}
    outer = json.loads(result.stdout)
    text = outer.get('result', result.stdout).strip()

    # Strip markdown fences if model adds them despite instructions
    if text.startswith('```'):
        lines = text.split('\n')
        text = '\n'.join(lines[1:-1] if lines[-1].strip() == '```' else lines[1:])

    return json.loads(text.strip())


def write_db_result(trade_id, bot_id, symbol, directive, conviction, analysis_text, chart_path):
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        INSERT OR REPLACE INTO signal_analysis
        (trade_id, bot_id, symbol, s6_directive, conviction_score, analysis_text, chart_image_path, processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (trade_id, bot_id, symbol, directive, conviction, analysis_text, str(chart_path), datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()


def process_job(job_path):
    with open(job_path) as f:
        job = json.load(f)

    if job.get('status') != 'pending':
        return

    job_id = job['jobId']
    bot_id = job['botId']
    symbol = job['symbol']
    trade_id = job['tradeId']
    side = job['side']
    entry_price = job['entryPrice']
    candles = job['candles']

    print(f'[{datetime.utcnow().isoformat()}] Processing {job_id} ({symbol} {side} @ {entry_price})')

    # Mark as processing to prevent concurrent runs picking it up
    job['status'] = 'processing'
    with open(job_path, 'w') as f:
        json.dump(job, f, indent=2)

    try:
        chart_path = render_chart(candles, job_id, side, symbol)
        print(f'  Chart: {chart_path}')

        result = run_vision_analysis(chart_path, side, entry_price, symbol)

        directive = result.get('directive', 'MONITOR')
        conviction = int(result.get('conviction', 3))
        analysis_text = result.get('analysis', '')
        print(f'  Analysis: {directive} ({conviction}/5) — {analysis_text[:100]}')

        write_db_result(trade_id, bot_id, symbol, directive, conviction, analysis_text, chart_path)

        job['status'] = 'done'
        job['chart_path'] = str(chart_path)
        job['directive'] = directive
        job['conviction'] = conviction

    except Exception as e:
        print(f'  ERROR: {e}')
        traceback.print_exc()
        # Still write chart path to DB even if analysis failed
        chart_path_str = str(CHART_DIR / f'{job_id}.png') if (CHART_DIR / f'{job_id}.png').exists() else None
        write_db_result(trade_id, bot_id, symbol, None, None, None, chart_path_str)
        job['status'] = 'error'
        job['error'] = str(e)

    with open(job_path, 'w') as f:
        json.dump(job, f, indent=2)


def main():
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    ensure_db_table(DB_PATH)

    pending = []
    for job_path in sorted(QUEUE_DIR.glob('*.json')):
        try:
            data = json.loads(job_path.read_text())
            if data.get('status') == 'pending':
                pending.append(job_path)
        except Exception:
            pass

    if not pending:
        print(f'[{datetime.utcnow().isoformat()}] No pending jobs')
        return

    print(f'[{datetime.utcnow().isoformat()}] Found {len(pending)} pending job(s)')
    for job_path in pending:
        process_job(job_path)


if __name__ == '__main__':
    main()
