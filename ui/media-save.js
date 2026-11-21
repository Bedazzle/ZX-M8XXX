// The Save -> Media panel: everything currently inserted, and a way to get it
// out of the emulator.
//
// WHY THIS EXISTS
//
// A game that saves progress writes to the disk in the drive, and that disk is
// a buffer inside the controller. Until this panel there was no way to get most
// of them back out: the Save menu offered only DSK and TRD/SCL, so a program
// that saved to a +D, Opus, Didaktik or Microdrive wrote into something the
// user could never export. Those two entries also acted on "the drive selected
// in Settings -> Disk", which is a long way from the button being pressed.
//
// So this lists the drives instead of making the user find them, and marks the
// ones that have been written to -- that mark is the whole point, because a
// disk with unsaved progress looks exactly like one without.

export function initMediaSave({ getSpectrum, showMessage, downloadFile }) {
    const modal = document.getElementById('mediaSaveModal');
    const list = document.getElementById('mediaSaveList');
    const hint = document.getElementById('mediaSaveHint');
    const btnSaveAll = document.getElementById('btnMediaSaveAll');
    const btnClose = document.getElementById('btnMediaSaveClose');
    if (!modal || !list) return { open: () => {} };

    let items = [];

    function saveOne(item) {
        try {
            const data = item.getData();
            if (!data || !data.length) {
                showMessage(`${item.label}: nothing to save`, 'error');
                return false;
            }
            downloadFile(item.filename, data);
            return true;
        } catch (e) {
            showMessage(`${item.label}: ${e.message}`, 'error');
            return false;
        }
    }

    function render() {
        items = getSpectrum().getSaveableMedia();
        list.innerHTML = '';

        // The hint speaks only when it has news. A standing line of prose above
        // a single row was the bulk of the dialog, and the one it used to show
        // ("nothing has been written to since loading") read as a refusal next
        // to the Save button it sat beside.
        const say = (text) => {
            hint.textContent = text;
            hint.classList.toggle('hidden', !text);
        };

        if (items.length === 0) {
            list.innerHTML = '<div class="media-empty">No disks or cartridges inserted.</div>';
            say('');
            btnSaveAll.classList.add('hidden');
            return;
        }

        const written = items.filter(i => i.modified).length;
        say(written
            ? `● ${written} of ${items.length} ${written === 1 ? 'has' : 'have'} been written to since loading.`
            : '');
        // "Save all" against a single row is two names for one button, which is
        // exactly how it read. It belongs there only when there is more than one.
        btnSaveAll.classList.toggle('hidden', items.length < 2);

        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'media-row';

            const slot = document.createElement('span');
            slot.className = 'media-slot';
            slot.textContent = item.label;

            const name = document.createElement('span');
            name.className = 'media-name';
            // The name it will be SAVED as, not the name it was loaded under.
            // They are the same for a loaded file; where they differ the saved
            // one is what the row is offering -- a disk made by Blank TRD showed
            // "[blank]", which is a status, not a file.
            name.textContent = item.filename;
            if (item.note) {
                const note = document.createElement('span');
                note.className = 'media-note';
                note.textContent = ' — ' + item.note;
                name.appendChild(note);
            }

            // The dot, not the word "modified": the row is already busy, and this
            // is the one thing on it worth scanning a column for.
            const dot = document.createElement('span');
            dot.className = 'media-dot';
            dot.textContent = item.modified ? '●' : '';
            dot.title = item.modified
                ? 'The program has written to this since it was loaded'
                : '';

            const btn = document.createElement('button');
            btn.textContent = 'Save';
            btn.title = `Save as ${item.filename}`;
            btn.addEventListener('click', () => {
                if (saveOne(item)) showMessage(`Saved ${item.filename}`);
            });

            row.append(dot, slot, name, btn);
            list.appendChild(row);
        }
    }

    btnSaveAll.addEventListener('click', () => {
        let n = 0;
        for (const item of items) if (saveOne(item)) n++;
        if (n) showMessage(`Saved ${n} file${n === 1 ? '' : 's'}`);
    });

    const close = () => modal.classList.add('hidden');
    btnClose.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });

    return {
        open() {
            // Re-read on every open: a drive can be loaded, written to or
            // swapped while the panel is shut.
            render();
            modal.classList.remove('hidden');
        }
    };
}
