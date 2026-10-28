from playwright.sync_api import sync_playwright
B='http://localhost:8788'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome'); errs=[]
    c=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,geolocation={'latitude':40.37,'longitude':-105.6},permissions=['geolocation'])
    pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(B+'/'); pg.click('#me'); pg.wait_for_selector('.c')
    first=pg.eval_on_selector('.c h2','e=>e.textContent')
    pg.click('.c >> text=Report a correction'); pg.wait_for_load_state()
    print('correction prefilled:',pg.input_value('#park_name'),pg.input_value('#park_id')); pid=pg.input_value('#park_id')
    pg.select_option('select[name=field]','pet_fee'); pg.fill('input[name=claimed_value]','$5 per pet per night'); pg.fill('input[name=evidence_url]','https://example.org/sign.jpg')
    pg.screenshot(path='screenshots/correction_form.png',full_page=True)
    pg.click('button'); pg.wait_for_selector('#msg.ok'); print('corr:',pg.inner_text('#msg'))
    pg.screenshot(path='screenshots/correction_submitted.png')
    pg.goto(B+f'/owner.html?park={pid}&name={first}')
    for n,v in [('breed_restrictions','None'),('size_limit','No limit'),('max_pets','3'),('pet_fee','No fee'),('leash_rule','6 ft leash at all times'),('contact_email','manager@example.com'),('website_url','https://www.nps.gov/romo/planyourvisit/pets.htm')]: pg.fill(f'[name={n}]',v)
    pg.select_option('[name=pets_allowed]','yes'); pg.select_option('[name=off_leash_area]','no')
    pg.screenshot(path='screenshots/owner_form.png',full_page=True)
    pg.click('button'); pg.wait_for_selector('#msg.ok'); print('owner:',pg.inner_text('#msg'))
    a=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,http_credentials={'username':'admin','password':__import__('os').environ.get('ADMIN_PASSWORD','')})
    ap=a.new_page(); ap.goto(B+'/admin'); ap.wait_for_selector('.c'); ap.screenshot(path='screenshots/admin_queue.png')
    ap.check('.c input[type=checkbox]'); ap.fill('.c input[type=text]','website matches'); ap.click('.c button.a'); ap.wait_for_timeout(1000)
    pg.goto(B+'/'); pg.click('#me'); pg.wait_for_selector('.c'); pg.wait_for_timeout(500)
    print('card facts:',pg.inner_text('.c')[:600]); pg.screenshot(path='screenshots/card_owner_confirmed.png'); print('errors',errs)
