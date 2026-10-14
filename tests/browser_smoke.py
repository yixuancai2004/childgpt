"""Optional real-browser smoke suite. Requires playwright and Chromium; not needed to run the app.
Run: python tests/browser_smoke.py --base http://127.0.0.1:8000
Use --chromium /path/to/chrome when no system chromium is available.
"""
import argparse
import json
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:8000')
parser.add_argument('--chromium', default=shutil.which('chromium'))
parser.add_argument('--inline-preview', action='store_true', help='Render the bundled document without navigation; skip browser-network/persistence tests.')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'results' / 'ui'
OUT.mkdir(exist_ok=True, parents=True)
checks = []
EXPECTED = json.loads((ROOT / 'results' / 'evaluation.json').read_text())
TOTAL = EXPECTED['functional']['total']
MONTE = EXPECTED['monteCarlo']
pct = lambda x: f'{x * 100:.1f}%'

def record(name):
    checks.append({'name': name, 'pass': True})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.chromium, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1480, 'height': 1080}, device_scale_factor=1, bypass_csp=True)  # test harness only: wait_for_function evaluates strings
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    if args.inline_preview:
        page.set_content((ROOT / 'ChildGPT-demo.html').read_text(), wait_until='load')
    else:
        page.goto(args.base, wait_until='networkidle')
    assert page.locator('#memory-count').inner_text() == '0'
    assert page.locator('#mode-badge').inner_text() == '● KEY-FREE DEMO'
    record('Fresh static UI starts without API or seed memory')
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(OUT / 'studio-empty.png'), full_page=True)
    page.click('#guided-demo')
    page.wait_for_function("document.querySelectorAll('.message').length === 12 && !document.querySelector('#guided-demo').disabled", timeout=15000)
    assert page.locator('#memory-count').inner_text() == '1'
    assert 'warm tea' in page.locator('#memory-list').inner_text()
    record('Guided teach → recall → omission → correction → recall completes')
    page.evaluate('window.scrollTo(0,0)')
    page.locator('#toast').evaluate('(el) => el.hidden=true')
    page.screenshot(path=str(OUT / 'studio.png'), full_page=True)
    page.select_option('#profile-select', 'learner-b')
    assert page.locator('#memory-count').inner_text() == '0'
    page.click('[data-action="ask"]')
    page.fill('#concept-input', 'tavi')
    page.click('#send-button')
    assert 'not learned' in page.locator('.message.assistant').last.inner_text()
    record('Profile B cannot retrieve profile A knowledge through UI')
    page.select_option('#profile-select', 'learner-a')
    page.click('.nav-link[data-page="algorithms"]')
    assert 'a happy moment shared over warm tea' in page.locator('#live-trace').inner_text()
    record('Algorithm inspector renders actual stored provenance and actions')
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(OUT / 'algorithms.png'), full_page=True)
    page.click('.nav-link[data-page="evaluation"]')
    page.click('#run-tests')
    assert f'{TOTAL}/{TOTAL} passed' in page.locator('#functional-results').inner_text()
    record(f'Browser actually executes all {TOTAL} controller checks')
    page.click('#run-monte')
    assert pct(MONTE['stableSequenceFalseAlarmRate']) in page.locator('#monte-results').inner_text()
    assert pct(MONTE['detectedAfterChangeRate']) in page.locator('#monte-results').inner_text()
    assert pct(MONTE['temporaryAlarmRate']) in page.locator('#monte-results').inner_text()
    record('600-run simulation and threshold sweep reproduce CLI metrics including false alarms')
    page.evaluate('window.scrollTo(0,0)')
    page.locator('#toast').evaluate('(el) => el.hidden=true')
    page.screenshot(path=str(OUT / 'evaluation.png'), full_page=True)
    with page.expect_download() as d:
        page.click('#export-results')
    export = json.loads(Path(d.value.path()).read_text())
    assert export['functional']['passed'] == TOTAL
    assert export['monteCarlo']['stableFalseAlarmCount'] == MONTE['stableFalseAlarmCount']
    assert len(export['thresholdSweep']) >= 6
    record('Evaluation JSON export contains executed counts, not target placeholders')
    with page.expect_download() as d:
        page.click('#export-csv')
    csv = Path(d.value.path()).read_text()
    assert len(csv.strip().splitlines()) == 61
    record('Simulation CSV exports 60 days plus header')
    with page.expect_download() as d:
        page.click('#export-svg')
    assert '<svg' in Path(d.value.path()).read_text()
    record('CUSUM chart SVG downloads successfully')
    if not args.inline_preview:
        page.click('.nav-link[data-page="settings"]')
        page.check('#remember-toggle')
        page.reload(wait_until='networkidle')
        assert page.locator('#memory-count').inner_text() == '1'
        record('Opt-in local memory survives reload')
        page.fill('#backend-url', args.base)
        page.click('#connect-form button[type="submit"]')
        page.wait_for_function("document.querySelector('#mode-badge').textContent.includes('SERVER DEMO')")
        assert page.locator('#memory-count').inner_text() == '0'
        record('Blank-provider backend connects as an isolated server demo')
        page.click('.nav-link[data-page="studio"]')
        page.click('[data-action="teach"]')
        page.fill('#concept-input', 'server-fact')
        page.fill('#content-input', '<img src=x onerror="window.pwned=1"> harmless synthetic test')
        page.click('#send-button')
        page.wait_for_function("document.querySelector('#memory-count').textContent==='1'")
        assert page.evaluate('window.pwned') is None
        assert page.locator('#memory-list img').count() == 0
        record('User-taught HTML renders as text, not executable markup')
        page.reload(wait_until='networkidle')
        page.wait_for_function("document.querySelector('#mode-badge').textContent.includes('SERVER DEMO')")
        assert 'server-fact' in page.locator('#memory-list').inner_text()
        record('Backend bearer session and stored memory survive tab reload')
        page.click('.nav-link[data-page="settings"]')
        page.click('#disconnect')
        assert 'warm tea' in page.locator('#memory-list').inner_text()
        record('Disconnect restores separate local demo rather than mixing server memory')
        page.click('#delete-profile')
        assert page.locator('#memory-count').inner_text() == '0'
        page.reload(wait_until='networkidle')
        assert page.locator('#memory-count').inner_text() == '0'
        record('Profile deletion removes persisted local data')
    else:
        page.click('.nav-link[data-page="studio"]')
        page.click('[data-action="teach"]')
        page.fill('#concept-input', 'markup-test')
        page.fill('#content-input', '<img src=x onerror="window.pwned=1"> synthetic example')
        page.click('#send-button')
        assert page.evaluate('window.pwned') is None
        assert page.locator('#memory-list img').count() == 0
        record('User-taught HTML renders as text, not executable markup')
    assert errors == [], errors
    record('Desktop flow has no uncaught JavaScript errors')
    mobile = browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    mp = mobile.new_page()
    if args.inline_preview:
        mp.set_content((ROOT / 'ChildGPT-demo.html').read_text(), wait_until='load')
    else:
        mp.goto(args.base,wait_until='networkidle')
    assert mp.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    mp.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
    record('390px mobile viewport has no horizontal overflow')
    standalone = browser.new_context(viewport={'width':1280,'height':900})
    sp = standalone.new_page()
    standalone_errors = []
    external_requests = []
    sp.on('pageerror', lambda e: standalone_errors.append(str(e)))
    sp.on('request', lambda r: external_requests.append(r.url) if r.url.startswith(('http://','https://')) else None)
    if args.inline_preview:
        sp.set_content((ROOT / 'ChildGPT-demo.html').read_text(), wait_until='load')
    else:
        sp.goto((ROOT / 'ChildGPT-demo.html').as_uri(),wait_until='load')
    sp.click('[data-action="teach"]')
    sp.fill('#concept-input','offline-word')
    sp.fill('#content-input','a completely offline lesson')
    sp.click('#send-button')
    assert sp.locator('#memory-count').inner_text() == '1'
    assert standalone_errors == [], standalone_errors
    assert external_requests == [], external_requests
    record('Bundled standalone document teaches with zero external requests' + (' (inline rendering)' if args.inline_preview else ''))
    browser.close()

report = {'suite':'Real Chromium browser smoke tests','passed':len(checks),'total':len(checks),'checks':checks,'scope':'Executed browser checks listed below; no live model provider calls.', 'inlinePreview': args.inline_preview, 'environmentNotes': 'This environment blocks browser navigation to local URLs and files. Inline document rendering was used; direct file loading and browser-to-backend/persistence tests were not executed. HTTP backend and persistence checks were executed separately by the Node suite.' if args.inline_preview else 'Full browser navigation suite.'}
(ROOT / 'results' / 'browser-tests.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
