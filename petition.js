/* ------------------------------------------------------------------
   The petition: "Ivan Dubovyi for President of the Class of 2030".

   Shared by the section on the home page and the page at /petition, so
   the two can never drift apart. Either page only has to carry the
   markup with these ids and load this file.

   The form posts to the same Apps Script backend the calendar uses, and
   that backend owns every rule worth trusting: what counts as a name,
   one signature per person, and whether the running total is large
   enough to show. The checks here exist to answer instantly.
------------------------------------------------------------------ */
(function () {
    "use strict";

    const form = document.getElementById('petitionForm');
    if (!form) return;

    const API = ((window.CALENDAR_CONFIG || {}).API_URL || '').trim();
    const SIGNED_KEY = 'petition_signed';

    const el = (id) => document.getElementById(id);
    const nameInput = el('petitionName');
    const line = el('petitionLine');
    const errorBox = el('petitionError');
    const submit = el('petitionSubmit');
    const submitText = el('petitionSubmitText');
    const doneView = el('petitionDone');
    const doneTitle = el('petitionDoneTitle');
    const countBox = el('petitionCount');
    const countNum = el('petitionCountNum');
    const countLabel = el('petitionCountLabel');
    const shareBtn = el('petitionShare');
    const shareText = el('petitionShareText');

    const SHARE_LABEL = shareText ? shareText.textContent : '';

    const remember = (v) => { try { localStorage.setItem(SIGNED_KEY, v); } catch (e) { /* private mode */ } };
    const remembered = () => { try { return localStorage.getItem(SIGNED_KEY); } catch (e) { return null; } };

    function showError(message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
        line.classList.add('has-error');
        nameInput.setAttribute('aria-invalid', 'true');
    }
    function clearError() {
        errorBox.hidden = true;
        errorBox.textContent = '';
        line.classList.remove('has-error');
        nameInput.removeAttribute('aria-invalid');
    }
    nameInput.addEventListener('input', clearError);

    /* Only ever called with a number the backend chose to publish. */
    function showCount(count) {
        if (typeof count !== 'number' || !countBox) return;
        countNum.textContent = count.toLocaleString('en-US');
        countLabel.textContent = count === 1 ? 'signature so far' : 'signatures so far';
        countBox.hidden = false;
    }

    /* The same tidying the backend does to the name it saves, so the
       thank-you greets "jake" as Jake and leaves McDonald alone. */
    function tidyCase(name) {
        if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
        return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu,
            (m, lead, ch) => lead + ch.toUpperCase());
    }

    function showSigned(firstName) {
        doneTitle.textContent = firstName ? 'Signed, ' + tidyCase(firstName) : 'Signed';
        form.hidden = true;
        doneView.hidden = false;
    }

    // A browser that has signed before opens on the thank-you.
    const already = remembered();
    if (already) showSigned(already === '1' ? '' : already);

    /* The site and the Apps Script backend deploy separately, so a page can
       go live minutes before the backend that stores signatures. A backend
       that answers cleanly and says nothing about a petition is an older
       one: the form steps aside rather than letting somebody type their
       name and hit "Unknown action." A failed request changes nothing,
       because a dropped connection proves nothing about what is deployed. */
    let backendReady = true;
    function backendIsOlder() {
        backendReady = false;
        if (form.hidden) return;
        submit.disabled = true;
        submitText.textContent = 'Signing opens shortly';
        showError('Signing opens here shortly. Thanks for backing me.');
    }

    // The number as it stands right now, when there is one to show.
    if (API) {
        fetch(API + (API.indexOf('?') === -1 ? '?' : '&') + 'action=petition',
              { method: 'GET', redirect: 'follow' })
            .then((r) => r.json())
            .then((out) => {
                if (out && out.petition) showCount(out.petition.count);
                else backendIsOlder();
            })
            .catch(() => { /* the form still works; only the number waits */ });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        clearError();

        const typed = nameInput.value.replace(/\s+/g, ' ').trim();
        if (typed.split(' ').filter(Boolean).length < 2) {
            showError('Please add your first and last name.');
            nameInput.focus();
            return;
        }
        if (!API || !backendReady) {
            showError('Signing opens here shortly. Thanks for backing me.');
            return;
        }

        submit.disabled = true;
        submitText.textContent = 'Signing…';

        fetch(API, {
            method: 'POST',
            // text/plain keeps this a simple request, so the browser skips
            // the CORS preflight that Apps Script leaves unanswered
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'petitionSign',
                name: typed,
                website: el('petitionWebsite').value,
            }),
            redirect: 'follow',
        })
            .then((r) => r.json())
            .then((out) => {
                if (out && out.error) { showError(out.error); return; }
                const firstName = typed.split(' ')[0];
                remember(firstName || '1');
                showCount(out && out.count);
                showSigned(firstName);
                doneTitle.focus();
            })
            .catch(() => {
                showError('That signature stayed here. Please check your connection and try once more.');
            })
            .then(() => {
                submit.disabled = false;
                submitText.textContent = 'Sign the petition';
            });
    });

    /* Share sheet on a phone, the link on the clipboard everywhere else.
       Always the short address, which is the one worth reading out loud. */
    if (shareBtn) {
        shareBtn.addEventListener('click', function () {
            const url = location.origin + '/petition';
            const share = {
                title: 'Ivan Dubovyi for President of the Class of 2030',
                text: 'I just signed for Ivan Dubovyi. Add your name for the Class of 2030.',
                url: url,
            };
            if (navigator.share) {
                navigator.share(share).catch(() => { /* they closed the sheet */ });
                return;
            }
            const said = (word) => {
                shareText.textContent = word;
                setTimeout(() => { shareText.textContent = SHARE_LABEL; }, 2400);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url)
                    .then(() => said('Link copied'))
                    .catch(() => said(url));
                return;
            }
            said(url);
        });
    }
})();
