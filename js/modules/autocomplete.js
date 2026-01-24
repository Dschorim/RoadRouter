// autocomplete.js - modularized autocomplete helpers
import CONFIG from '../config.js';

export function ensureAutocompleteList() {
    let list = document.getElementById('autocomplete-list');
    if (list) return list;
    const portal = document.getElementById('autocompletePortal') || document.body;
    list = document.createElement('div');
    list.id = 'autocomplete-list';
    list.tabIndex = -1; // allow programmatic focus
    list.style.cssText = `position:absolute;background:var(--color-surface-light);border:1px solid var(--color-border);border-radius:8px;max-height:240px;overflow-y:auto;display:none;z-index:10002;box-shadow:var(--shadow-md);`;
    portal.appendChild(list);

    // close on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#autocomplete-list') && !e.target.closest('.search-input') && !e.target.closest('.search-input-wrapper')) {
            list.style.display = 'none';
        }
    });

    // keyboard navigation state
    list._activeIndex = -1;
    list.focusItemAt = function(idx) {
        const items = Array.from(list.querySelectorAll('.autocomplete-item'));
        items.forEach((it, i) => {
            const active = i === idx;
            it.classList.toggle('active', active);
            it.style.background = active ? 'var(--color-surface)' : 'transparent';
        });
        list._activeIndex = idx;
        if (idx >= 0 && items[idx]) {
            items[idx].scrollIntoView({ block: 'nearest' });
        }
    };

    return list;
}

export function formatDisplay(result) {
    const addr = result.address || result.properties || {};
    const road = addr.street || addr.road || addr.pedestrian || addr.name || addr.road_name || '';
    let hnValue = addr.housenumber || addr.house_number || addr.housenr || addr.hn || addr.number || '';
    if (!hnValue && addr.name) {
        const m = String(addr.name).trim().match(/^\s*(\d+[A-Za-z0-9\-\/\s]*)/);
        if (m) hnValue = m[1];
    }

    const locality = addr.city || addr.town || addr.village || addr.county || addr.state || '';
    const country = addr.country || '';

    let main = '';
    if (road) {
        main = road + (hnValue ? (' ' + hnValue) : '');
    } else if (hnValue && addr.name) {
        main = addr.name;
    } else if (result.display_name) {
        main = (result.display_name || '').split(',')[0];
    } else if (result.properties && result.properties.name) {
        main = result.properties.name;
    }

    const sub = [locality, country].filter(Boolean).join(', ');
    return { main: main || result.display_name || (result.properties && result.properties.name) || '', sub };
}

export function showSuggestionsForInput(inputEl, items, onSelect) {
    const list = ensureAutocompleteList();
    const inputRect = inputEl.getBoundingClientRect();
    const parentRouteEl = inputEl.closest('.route-point-item');
    const containerRect = parentRouteEl ? parentRouteEl.getBoundingClientRect() : inputRect;

    list.innerHTML = '';
    list.style.left = (containerRect.left + window.scrollX) + 'px';
    list.style.top = (inputRect.bottom + window.scrollY) + 'px';
    list.style.width = containerRect.width + 'px';

    items.forEach(result => {
        const formatted = formatDisplay(result);
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.style.cssText = 'padding:10px 12px; border-bottom:1px solid var(--color-border); cursor:pointer;';

        const main = document.createElement('div');
        main.style.cssText = 'font-size:13px; color:var(--color-text); font-weight:600;';
        main.textContent = formatted.main;

        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:12px; color:var(--color-text-secondary); margin-top:4px;';
        sub.textContent = formatted.sub;

        item.appendChild(main);
        item.appendChild(sub);

        item.addEventListener('mouseenter', () => item.style.background = 'var(--color-surface)');
        item.addEventListener('mouseleave', () => item.style.background = 'transparent');

        item.addEventListener('click', () => {

            let lat = null, lon = null;
            if (typeof result.lat !== 'undefined' && typeof result.lon !== 'undefined') {
                lat = parseFloat(result.lat);
                lon = parseFloat(result.lon);
            } else if (result.geometry && Array.isArray(result.geometry.coordinates)) {
                lon = parseFloat(result.geometry.coordinates[0]);
                lat = parseFloat(result.geometry.coordinates[1]);
            } else if (result.properties && result.properties.lat && result.properties.lon) {
                lat = parseFloat(result.properties.lat);
                lon = parseFloat(result.properties.lon);
            }

            const display = formatted.main + (formatted.sub ? ', ' + formatted.sub : '');

            if (typeof onSelect === 'function') onSelect({ display, lat, lon, dataId: inputEl.dataset.pointId, result });
            list.style.display = 'none';
        });

        list.appendChild(item);
    });

    list.style.display = items.length > 0 ? 'block' : 'none';

    // reset active index
    list._activeIndex = -1;
}

// keyboard navigation handler
window.addEventListener('keydown', (e) => {
    const list = document.getElementById('autocomplete-list');
    if (!list || list.style.display === 'none') return;

    const items = Array.from(list.querySelectorAll('.autocomplete-item'));
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(list._activeIndex + 1, items.length - 1);
        list.focusItemAt(next);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(list._activeIndex - 1, 0);
        list.focusItemAt(prev);
    } else if (e.key === 'Enter') {
        if (list._activeIndex >= 0 && items[list._activeIndex]) {
            e.preventDefault();
            items[list._activeIndex].click();
        }
    } else if (e.key === 'Escape') {
        list.style.display = 'none';
    }
});

export function attachAutocompleteToInput(inputEl, pointIdLabel, opts = {}) {
    inputEl.dataset.pointId = pointIdLabel === 'initial' ? 'initial' : String(pointIdLabel);

    let timeout = null;

    function doSearch(query) {
        const photonUrl = `${CONFIG.PHOTONAPI}/api?q=${encodeURIComponent(query)}&limit=6&lang=en`;
        fetch(photonUrl)
            .then(r => r.json())
            .then(geo => {
                if (geo && Array.isArray(geo.features) && geo.features.length > 0) {
                    showSuggestionsForInput(inputEl, geo.features, opts.onSelect);
                } else {
                    const l = ensureAutocompleteList();
                    l.style.display = 'none';
                }
            })
            .catch(err => {
                console.error('Autocomplete search failed:', err);
                const l = ensureAutocompleteList();
                l.style.display = 'none';
            });
    }

    inputEl.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(timeout);
        if (query.length < 2) {
            const l = ensureAutocompleteList();
            l.style.display = 'none';
            return;
        }

        timeout = setTimeout(() => doSearch(query), 250);
    });

    inputEl.addEventListener('focus', () => {
        const q = inputEl.value.trim();
        if (q.length >= 2) {
            clearTimeout(timeout);
            doSearch(q);
        }
    });

    inputEl.addEventListener('keyup', (e) => {
        if (['ArrowDown','ArrowUp','Enter','Escape','Tab'].includes(e.key)) {
            return;
        }

        const q = inputEl.value.trim();
        if (q.length >= 2) {
            clearTimeout(timeout);
            timeout = setTimeout(() => doSearch(q), 150);
        } else {
            const l = ensureAutocompleteList();
            l.style.display = 'none';
        }
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const l = ensureAutocompleteList();
            const items = Array.from(l.querySelectorAll('.autocomplete-item'));
            if (l._activeIndex >= 0 && items[l._activeIndex]) {
                items[l._activeIndex].click();
            } else if (items[0]) {
                items[0].click();
            }
        } else if (e.key === 'Escape') {
            const l = ensureAutocompleteList();
            l.style.display = 'none';
        }
    });
}
