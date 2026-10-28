from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    c=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,geolocation={'latitude':40.37,'longitude':-105.6},permissions=['geolocation'])
    pg=c.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:8787/'); pg.click('#me'); pg.wait_for_selector('.c',timeout=15000)
    print(pg.inner_text('#st')); pg.screenshot(path='screenshot_mobile.png')
    pg.fill('#loc','Estes Park, CO'); pg.click('button:text("Go")'); pg.wait_for_timeout(4000); print('geocode:',pg.inner_text('#st'))
    pg.check('#fPets'); pg.wait_for_timeout(800); print('pets filter:',pg.inner_text('#st')); print('errors',errs)
