#!/usr/bin/env python3
"""
Phase 6 signal intelligence processor.
Reads pending jobs from /home/ubuntu/s2/data/analysis_queue/,
renders 1H candlestick charts, runs Claude vision analysis,
writes results to signal_analysis table in S2 SQLite DB.
"""

import os
import sys
import json
import base64
import sqlite3
import traceback
from pathlib import Path
from datetime import datetime

# Set non-interactive backend before any matplotlib import
import matplotlib
matplotlib.use('Agg')

QUEUE_DIR = Path('/home/ubuntu/s2/data/analysis_queue')
CHART_DIR = Path('/home/ubuntu/s2/data/charts')
DB_PATH = os.environ.get('S2_DB_PATH', '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')


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
    import urllib.request
    import urllib.error

    if not ANTHROPIC_API_KEY:
        print('ANTHROPIC_API_KEY not set — skipping vision analysis')
        return None

    with open(chart_path, 'rb') as f:
        image_b64 = base64.b64encode(f.read()).decode('utf-8')

    direction = 'LONG' if side == 'Buy' else 'SHORT'
    prompt = (
        f'You are a professional technical analyst reviewing a 1H candlestick chart.\n'
        f'A {direction} trade was just entered on {symbol} at {entry_price}.\n\n'
        f'Analyse the chart and respond with JSON only (no markdown, no explanation):\n'
        f'{{"directive":"<TRADE|WAIT|AVOID|MONITOR>","conviction":<1-5>,"analysis":"<2-3 sentences>"}}\n\n'
        f'Directive meanings:\n'
        f'TRADE — strong setup, trend/momentum aligns with entry direction\n'
        f'WAIT — developing but needs more confirmation\n'
        f'AVOID — counter-trend, weak momentum, or high-risk setup\n'
        f'MONITOR — neutral/unclear, watch next few candles'
    )

    payload = {
        'model': 'claude-opus-4-7',
        'max_tokens': 300,
        'messages': [{
            'role': 'user',
            'content': [
                {
                    'type': 'image',
                    'source': {
                        'type': 'base64',
                        'media_type': 'image/png',
                        'data': image_b64,
                    },
                },
                {'type': 'text', 'text': prompt},
            ],
        }],
    }

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        method='POST',
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    text = data['content'][0]['text'].strip()
    # Strip markdown code fences if model adds them despite instructions
    if text.startswith('```'):
        lines = text.split('\n')
        text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])

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

    # Mark as processing to prevent concurrent run from picking it up
    job['status'] = 'processing'
    with open(job_path, 'w') as f:
        json.dump(job, f, indent=2)

    try:
        chart_path = render_chart(candles, job_id, side, symbol)
        print(f'  Chart: {chart_path}')

        result = run_vision_analysis(chart_path, side, entry_price, symbol)

        if result:
            directive = result.get('directive', 'MONITOR')
            conviction = int(result.get('conviction', 3))
            analysis_text = result.get('analysis', '')
            print(f'  Analysis: {directive} ({conviction}/5) — {analysis_text[:100]}')
        else:
            directive = conviction = analysis_text = None

        write_db_result(trade_id, bot_id, symbol, directive, conviction, analysis_text, chart_path)

        job['status'] = 'done'
        job['chart_path'] = str(chart_path)
        if directive:
            job['directive'] = directive
            job['conviction'] = conviction

    except Exception as e:
        print(f'  ERROR: {e}')
        traceback.print_exc()
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
