// autocomplete.js - modularized autocomplete helpers
import CONFIG from '../config.js';
import { AUTH } from './auth.js';
import { APP } from './state.js';

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getReferencePoint() {
    const start = APP.routePoints.find(p => p.type === 'start' && p.lat !== null);
    if (start) return { lat: start.lat, lng: start.lng };
    
    const validPoints = APP.routePoints.filter(p => p.lat !== null && p.lng !== null);
    if (validPoints.length > 0) {
        const last = validPoints[validPoints.length - 1];
        return { lat: last.lat, lng: last.lng };
    }
    
    return null;
}

function sortByDistance(results, refPoint) {
    if (!refPoint) return results;
    
    return results.map(r => {
        let lat, lon;
        if (r.lat !== undefined && r.lon !== undefined) {
            lat = r.lat; lon = r.lon;
        } else if (r.geometry?.coordinates) {
            lon = r.geometry.coordinates[0]; lat = r.geometry.coordinates[1];
        } else if (r.properties?.lat && r.properties?.lon) {
            lat = r.properties.lat; lon = r.properties.lon;
        }
        
        const dist = (lat && lon) ? getDistanceKm(refPoint.lat, refPoint.lng, lat, lon) : Infinity;
        return { ...r, _distance: dist };
    }).sort((a, b) => a._distance - b._distance);
}

function scoreResult(result, queryTokens) {
    const props = result.properties || {};
    const street = (props.street || props.road || props.name || '').toLowerCase();
    const city = (props.city || props.town || props.village || '').toLowerCase();
    const lastToken = queryTokens[queryTokens.length - 1]?.toLowerCase() || '';
    
    if (!lastToken) return 0;
    
    // Single token: prioritize street matches
    if (queryTokens.length === 1) {
        if (street.startsWith(lastToken)) return 100;
        if (street.includes(' ' + lastToken)) return 80;
        if (street.includes(lastToken)) return 50;
        if (city.startsWith(lastToken)) return 30;
        if (city.includes(lastToken)) return 10;
        return 0;
    }
    
    // Multi-token: last token is likely city
    if (city.startsWith(lastToken)) return 100;
    if (city.includes(' ' + lastToken)) return 50;
    if (city.includes(lastToken)) return 10;
    return 0;
}

function rankResults(results, query) {
    const tokens = query.trim().split(/\s+/);
    
    const seen = new Set();
    return results
        .map(r => ({ ...r, _score: scoreResult(r, tokens) }))
        .sort((a, b) => {
            if (b._score !== a._score) return b._score - a._score;
            return (a._distance || 0) - (b._distance || 0);
        })
        .filter(r => {
            let lat, lon;
            if (r.lat !== undefined && r.lon !== undefined) {
                lat = r.lat; lon = r.lon;
            } else if (r.geometry?.coordinates) {
                lon = r.geometry.coordinates[0]; lat = r.geometry.coordinates[1];
            }
            const key = `${lat?.toFixed(4)},${lon?.toFixed(4)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

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
    list.focusItemAt = function (idx) {
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
        main.style.cssText = 'font-size:13px; color:var(--color-text); font-weight:600; display:flex; align-items:center; gap:6px;';
        
        if (result._isHistory) {
            const badge = document.createElement('span');
            badge.style.cssText = 'font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700;';
            if (result._historyType === 'top') {
                badge.textContent = `★${result._count}`;
                badge.style.background = 'var(--accent-orange)';
                badge.style.color = 'var(--color-bg)';
            } else {
                badge.textContent = '⏱';
                badge.style.background = 'var(--accent-blue)';
                badge.style.color = 'var(--color-bg)';
            }
            main.appendChild(badge);
        }
        
        const textSpan = document.createElement('span');
        textSpan.textContent = formatted.main;
        main.appendChild(textSpan);

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
            
            if (AUTH.isAuthenticated() && !result._isHistory) {
                AUTH.saveSearch(display, result);
            }

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
    let userLocation = null;

    if (navigator.geolocation && !getReferencePoint()) {
        navigator.geolocation.getCurrentPosition(
            pos => { userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
            () => {}
        );
    }

    async function doSearch(query) {
        const photonUrl = `${CONFIG.PHOTONAPI}/api?q=${encodeURIComponent(query)}&limit=100&lang=en`;
        
        let historyResults = [];
        if (AUTH.isAuthenticated()) {
            const [top, recent] = await Promise.all([
                AUTH.getTopSearches(),
                AUTH.getRecentSearches()
            ]);
            
            const lowerQuery = query.toLowerCase();
            const topMatches = top.filter(h => h.query.toLowerCase().includes(lowerQuery)).slice(0, 3);
            const recentMatches = recent.filter(h => h.query.toLowerCase().includes(lowerQuery) && !topMatches.find(t => t.id === h.id)).slice(0, 2);
            
            historyResults = [...topMatches.map(h => ({ ...h.result_data, _isHistory: true, _historyType: 'top', _count: h.search_count })), 
                             ...recentMatches.map(h => ({ ...h.result_data, _isHistory: true, _historyType: 'recent' }))];
        }
        
        fetch(photonUrl)
            .then(r => r.json())
            .then(geo => {
                let photonResults = (geo && Array.isArray(geo.features)) ? geo.features : [];
                
                const refPoint = getReferencePoint() || userLocation;
                if (refPoint) {
                    photonResults = sortByDistance(photonResults, refPoint);
                }
                
                photonResults = rankResults(photonResults, query).slice(0, 8);
                
                const combined = [...historyResults, ...photonResults];
                
                if (combined.length > 0) {
                    showSuggestionsForInput(inputEl, combined, opts.onSelect);
                } else {
                    const l = ensureAutocompleteList();
                    l.style.display = 'none';
                }
            })
            .catch(err => {
                console.error('Autocomplete search failed:', err);
                if (historyResults.length > 0) {
                    showSuggestionsForInput(inputEl, historyResults, opts.onSelect);
                } else {
                    const l = ensureAutocompleteList();
                    l.style.display = 'none';
                }
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

        timeout = setTimeout(() => doSearch(query), 50);
    });

    inputEl.addEventListener('focus', () => {
        const q = inputEl.value.trim();
        if (q.length >= 2) {
            clearTimeout(timeout);
            doSearch(q);
        }
    });

    inputEl.addEventListener('keyup', (e) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
            return;
        }

        const q = inputEl.value.trim();
        if (q.length >= 2) {
            clearTimeout(timeout);
            timeout = setTimeout(() => doSearch(q), 50);
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
