/* Genre Section plugin – renders a row of genre thumbnails on the Jellyfin home screen. */
(function () {
    'use strict';

    if (window.__genreSectionPlugin) {
        return;
    }
    window.__genreSectionPlugin = true;

    var SECTION_CLASS = 'genreSectionPlugin';
    var DATA_TTL = 15 * 60 * 1000;
    var CANDIDATES_PER_GENRE = 12;

    var settingsCache = null; // { key, value } - dropped whenever the user navigates, so changes apply on the next visit
    var dataCache = null; // { key, time, value }
    var pending = null;
    var scheduled = false;

    // ---------------------------------------------------------------- helpers

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getApiClient() {
        var client = window.ApiClient;
        if (!client || typeof client.getCurrentUserId !== 'function' || !client.getCurrentUserId()) {
            return null;
        }
        return client;
    }

    function cacheKey(client) {
        return client.serverId() + '|' + client.getCurrentUserId();
    }

    function hashHue(text) {
        var hash = 0;
        for (var i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return Math.abs(hash) % 360;
    }

    var MOVIE_WORDS = {
        en: ['movie', 'movies'],
        de: ['Film', 'Filme'],
        fr: ['film', 'films'],
        es: ['película', 'películas'],
        it: ['film', 'film'],
        nl: ['film', 'films'],
        pt: ['filme', 'filmes'],
        pl: ['film', 'filmów'],
        sv: ['film', 'filmer'],
        da: ['film', 'film'],
        nb: ['film', 'filmer']
    };

    // Uses the language from the plugin settings (server UI language unless set explicitly).
    function movieWord(count, language) {
        var lang = String(language || 'en').toLowerCase().split(/[-_]/)[0];
        var words = MOVIE_WORDS[lang] || MOVIE_WORDS.en;
        return count === 1 ? words[0] : words[1];
    }

    function resolveUrl(client, url) {
        if (!url) {
            return '';
        }
        if (/^(https?:|data:|blob:|\/)/i.test(url)) {
            return url;
        }
        return client.getUrl(url);
    }

    function injectStyles() {
        if (document.getElementById('genreSectionPluginStyles')) {
            return;
        }
        var css = ''
            // The row reuses the web client's scroller and card markup, so themes style it like every other row.
            // Only scrolling itself is handled here, because the client's emby-scroller element is not used.
            + '.' + SECTION_CLASS + ' .gsp-row{overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;}'
            + '.' + SECTION_CLASS + ' .gsp-row::-webkit-scrollbar{display:none;}'
            + '.layout-desktop .' + SECTION_CLASS + ' .gsp-row{cursor:grab;}'
            + '.' + SECTION_CLASS + ' .gsp-row.gsp-dragging{cursor:grabbing;user-select:none;}'
            + '.' + SECTION_CLASS + ' .gsp-row.gsp-dragging .card{pointer-events:none;}'
            + '.' + SECTION_CLASS + ' .card a{-webkit-user-drag:none;}'
            // Large centered name, like the text on the library tiles. Sized relative to the card width.
            + '.' + SECTION_CLASS + ' .cardScalable{container-type:inline-size;}'
            + '.' + SECTION_CLASS + ' .gsp-image-name{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
            + 'padding:0 6%;box-sizing:border-box;background:rgba(0,0,0,.28);color:#fff;font-weight:700;text-align:center;'
            + 'line-height:1.1;white-space:normal;overflow-wrap:anywhere;font-size:2em;font-size:12cqi;'
            + 'text-shadow:0 2px 8px rgba(0,0,0,.55);}'
            // Scroll buttons use the web client's own classes; only show them where the client shows its own.
            + '.' + SECTION_CLASS + ' .gsp-scrollbuttons{display:none;}'
            + '.layout-desktop .' + SECTION_CLASS + ' .gsp-scrollbuttons{display:flex;}'
            + '@media (pointer:coarse){.' + SECTION_CLASS + ' .gsp-scrollbuttons{display:none !important;}}';
        var style = document.createElement('style');
        style.id = 'genreSectionPluginStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------- data

    function getSettings(client) {
        var key = cacheKey(client);
        if (settingsCache && settingsCache.key === key) {
            return Promise.resolve(settingsCache.value);
        }
        return client.getJSON(client.getUrl('GenreSection/Settings')).then(function (value) {
            settingsCache = { key: key, value: value };
            return value;
        });
    }

    function getMovieLibraryId(client, settings) {
        if (settings.LibraryId) {
            return Promise.resolve(settings.LibraryId);
        }
        // No library configured: if there is exactly one movie library, use it so only movies are listed.
        return client.getJSON(client.getUrl('UserViews', { userId: client.getCurrentUserId() }))
            .then(function (result) {
                var movieViews = (result.Items || []).filter(function (v) {
                    return (v.CollectionType || '').toLowerCase() === 'movies';
                });
                return movieViews.length === 1 ? movieViews[0].Id : '';
            })
            .catch(function () {
                return '';
            });
    }

    function loadGenreCandidates(client, genre, parentId) {
        var query = {
            userId: client.getCurrentUserId(),
            GenreIds: genre.Id,
            IncludeItemTypes: 'Movie',
            Recursive: true,
            SortBy: 'CommunityRating,SortName',
            SortOrder: 'Descending',
            Limit: CANDIDATES_PER_GENRE,
            EnableImageTypes: 'Backdrop,Primary',
            ImageTypeLimit: 1,
            EnableUserData: false,
            Fields: ''
        };
        if (parentId) {
            query.ParentId = parentId;
        }
        return client.getJSON(client.getUrl('Items', query)).then(function (result) {
            var items = (result.Items || []).filter(function (item) {
                return item.BackdropImageTags && item.BackdropImageTags.length;
            }).map(function (item) {
                return { id: item.Id, tag: item.BackdropImageTags[0] };
            });
            return { count: result.TotalRecordCount || 0, backdrops: items };
        }).catch(function () {
            return { count: 0, backdrops: [] };
        });
    }

    function loadData(client, settings) {
        var key = cacheKey(client) + '|' + JSON.stringify(settings);
        if (dataCache && dataCache.key === key && Date.now() - dataCache.time < DATA_TTL) {
            return Promise.resolve(dataCache.value);
        }

        return getMovieLibraryId(client, settings).then(function (parentId) {
            var query = {
                userId: client.getCurrentUserId(),
                IncludeItemTypes: 'Movie',
                Recursive: true,
                SortBy: 'SortName',
                SortOrder: 'Ascending',
                EnableImageTypes: 'Primary,Thumb,Backdrop',
                ImageTypeLimit: 1
            };
            if (parentId) {
                query.ParentId = parentId;
            }
            return client.getJSON(client.getUrl('Genres', query)).then(function (result) {
                var genres = result.Items || [];
                var entries = settings.Genres || [];
                var byName = {};
                entries.forEach(function (e) {
                    byName[(e.Name || '').toLowerCase()] = e;
                });

                var selected;
                if (settings.SelectionMode === 'Selected') {
                    var genreByName = {};
                    genres.forEach(function (g) {
                        genreByName[(g.Name || '').toLowerCase()] = g;
                    });
                    selected = entries.filter(function (e) {
                        return e.Enabled && genreByName[(e.Name || '').toLowerCase()];
                    }).map(function (e) {
                        return genreByName[e.Name.toLowerCase()];
                    });
                } else {
                    selected = genres;
                }

                return Promise.all(selected.map(function (genre) {
                    return loadGenreCandidates(client, genre, parentId).then(function (info) {
                        return { genre: genre, entry: byName[(genre.Name || '').toLowerCase()] || null, info: info };
                    });
                })).then(function (list) {
                    if (settings.SelectionMode !== 'Selected') {
                        var min = Math.max(settings.MinMovieCount || 0, 1);
                        list = list.filter(function (x) {
                            return x.info.count >= min;
                        });
                    }
                    if (settings.MaxGenres > 0) {
                        list = list.slice(0, settings.MaxGenres);
                    }
                    var value = { parentId: parentId, list: list };
                    dataCache = { key: key, time: Date.now(), value: value };
                    return value;
                });
            });
        });
    }

    // ---------------------------------------------------------------- render

    function pickImage(client, settings, x, used) {
        if (x.entry && x.entry.ImageUrl) {
            return resolveUrl(client, x.entry.ImageUrl);
        }
        // Prefer a movie that is not already the thumbnail of another genre.
        var backdrops = x.info.backdrops.filter(function (b) {
            return !used[b.id];
        });
        if (!backdrops.length) {
            backdrops = x.info.backdrops;
        }
        if (backdrops.length) {
            var pick = settings.RandomDefaultThumbs
                ? backdrops[Math.floor(Math.random() * backdrops.length)]
                : backdrops[0];
            used[pick.id] = true;
            return client.getUrl('Items/' + pick.id + '/Images/Backdrop/0', { maxWidth: 640, tag: pick.tag, quality: 90 });
        }
        var tags = x.genre.ImageTags || {};
        if (tags.Thumb) {
            return client.getUrl('Items/' + x.genre.Id + '/Images/Thumb', { maxWidth: 640, tag: tags.Thumb });
        }
        if (tags.Primary) {
            return client.getUrl('Items/' + x.genre.Id + '/Images/Primary', { maxWidth: 640, tag: tags.Primary });
        }
        return '';
    }

    function buildSection(client, settings, data) {
        var serverId = client.serverId();
        var used = {};
        var cards = data.list.map(function (x) {
            var name = (x.entry && x.entry.DisplayName) || x.genre.Name;
            var href = '#/list?genreId=' + encodeURIComponent(x.genre.Id) + '&serverId=' + encodeURIComponent(serverId);
            if (data.parentId) {
                href += '&parentId=' + encodeURIComponent(data.parentId);
            }
            var img = pickImage(client, settings, x, used);
            var hue = hashHue(x.genre.Name || '');
            var bg = 'background-image:linear-gradient(135deg,hsl(' + hue + ',55%,38%),hsl(' + ((hue + 50) % 360) + ',60%,18%));';
            if (img) {
                bg = 'background-image:url(\'' + img.replace(/'/g, '%27') + '\'),linear-gradient(135deg,hsl(' + hue + ',55%,38%),hsl('
                    + ((hue + 50) % 360) + ',60%,18%));';
            }
            var count = x.info.count ? x.info.count + ' ' + movieWord(x.info.count, settings.Language) : '';
            var link = ' href="' + escapeHtml(href) + '" draggable="false"';
            // Same markup as the web client's own cards (cardBuilder), so themes and CSS tweaks apply unchanged.
            // data-type="Genre" matches what the client uses for genre cards; plugins that decorate media cards
            // (e.g. Jellyfin Enhanced rating/language tags) skip that type.
            return '<div class="card overflowBackdropCard card-hoverable" data-isfolder="true" data-type="Genre"'
                + ' data-id="' + escapeHtml(x.genre.Id) + '" data-serverid="' + escapeHtml(serverId) + '" data-genre="' + escapeHtml(x.genre.Name) + '">'
                + '<div class="cardBox cardBox-bottompadded">'
                + '<div class="cardScalable">'
                + '<div class="cardPadder cardPadder-overflowBackdrop"></div>'
                + '<a' + link + ' class="cardImageContainer coveredImage cardContent" aria-label="' + escapeHtml(name) + '" role="img" style="' + escapeHtml(bg) + '">'
                + imageName(settings, name, !img)
                + '</a>'
                + '<a' + link + ' class="cardOverlayContainer" tabindex="-1" aria-hidden="true"></a>'
                + '</div>'
                + (settings.ShowGenreName
                    ? '<div class="cardText cardTextCentered cardText-first"><bdi><a' + link + ' class="textActionButton" title="' + escapeHtml(name) + '">'
                        + escapeHtml(name) + '</a></bdi></div>'
                        + '<div class="cardText cardTextCentered cardText-secondary"><bdi>' + escapeHtml(count || '\u00a0') + '</bdi></div>'
                    : '')
                + '</div></div>';
        }).join('');

        var section = document.createElement('div');
        section.className = 'verticalSection emby-scroller-container ' + SECTION_CLASS;
        section.innerHTML = ''
            + '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">'
            + '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(settings.SectionTitle || 'Genres') + '</h2>'
            + '</div>'
            + '<div class="emby-scrollbuttons padded-right gsp-scrollbuttons">'
            + scrollButtonHtml('left')
            + scrollButtonHtml('right')
            + '</div>'
            + '<div class="padded-top-focusscale padded-bottom-focusscale emby-scroller gsp-row" data-centerfocus="true">'
            + '<div class="itemsContainer scrollSlider focuscontainer-x" style="white-space:nowrap;">' + cards + '</div>'
            + '</div>';

        var row = section.querySelector('.gsp-row');
        // The home screen calls pause()/resume() on every ".itemsContainer" when it is hidden or shown.
        var items = section.querySelector('.itemsContainer');
        items.pause = function () {};
        items.resume = function () {
            return Promise.resolve();
        };
        var buttons = section.querySelectorAll('.emby-scrollbuttons-button');
        var updateButtons = function () {
            var max = row.scrollWidth - row.clientWidth;
            var scrollable = max > 20;
            buttons[0].classList.toggle('hide', !scrollable);
            buttons[1].classList.toggle('hide', !scrollable);
            buttons[0].disabled = row.scrollLeft <= 0;
            buttons[1].disabled = row.scrollLeft >= max - 1;
        };
        buttons[0].addEventListener('click', function () {
            row.scrollBy({ left: -row.clientWidth * 0.9, behavior: 'smooth' });
        });
        buttons[1].addEventListener('click', function () {
            row.scrollBy({ left: row.clientWidth * 0.9, behavior: 'smooth' });
        });
        row.addEventListener('scroll', updateButtons, { passive: true });
        window.addEventListener('resize', updateButtons);
        requestAnimationFrame(updateButtons);
        enableDragScroll(row);
        return section;
    }

    // Name drawn on the thumbnail. Without an image the name is always shown, otherwise the card is unlabeled.
    function imageName(settings, name, noImage) {
        var mode = settings.NameOnImage || 'Center';
        if (mode === 'Bottom' && !noImage) {
            // The web client's own caption bar (cardBuilder "overlayText").
            return '<div class="innerCardFooter fullInnerCardFooter"><div class="cardText cardText-first">' + escapeHtml(name) + '</div></div>';
        }
        if (mode === 'Center' || noImage) {
            return '<div class="gsp-image-name">' + escapeHtml(name) + '</div>';
        }
        return '';
    }

    function scrollButtonHtml(direction) {
        return '<button type="button" is="paper-icon-button-light" data-ripple="false" data-direction="' + direction + '"'
            + ' class="emby-scrollbuttons-button paper-icon-button-light" title="' + (direction === 'left' ? 'Previous' : 'Next') + '">'
            + '<span class="material-icons ' + (direction === 'left' ? 'chevron_left' : 'chevron_right') + '" aria-hidden="true"></span>'
            + '</button>';
    }

    // Click and drag with the mouse to scroll the row, with a little momentum on release.
    function enableDragScroll(row) {
        var pointerId = null;
        var startX = 0;
        var startLeft = 0;
        var lastX = 0;
        var lastTime = 0;
        var velocity = 0;
        var moved = false;
        var suppressClick = false;
        var momentumFrame = 0;

        function stopMomentum() {
            if (momentumFrame) {
                cancelAnimationFrame(momentumFrame);
                momentumFrame = 0;
            }
        }

        function momentum() {
            velocity *= 0.94;
            if (Math.abs(velocity) < 0.05) {
                momentumFrame = 0;
                return;
            }
            row.scrollLeft -= velocity * 16;
            momentumFrame = requestAnimationFrame(momentum);
        }

        row.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'mouse' || e.button !== 0) {
                return;
            }
            stopMomentum();
            pointerId = e.pointerId;
            startX = lastX = e.clientX;
            startLeft = row.scrollLeft;
            lastTime = performance.now();
            velocity = 0;
            moved = false;
        });

        row.addEventListener('pointermove', function (e) {
            if (e.pointerId !== pointerId) {
                return;
            }
            var dx = e.clientX - startX;
            if (!moved && Math.abs(dx) > 5) {
                moved = true;
                row.classList.add('gsp-dragging');
                row.setPointerCapture(pointerId);
            }
            if (moved) {
                row.scrollLeft = startLeft - dx;
                var now = performance.now();
                velocity = (e.clientX - lastX) / Math.max(now - lastTime, 1);
                lastX = e.clientX;
                lastTime = now;
            }
        });

        function end(e) {
            if (e.pointerId !== pointerId) {
                return;
            }
            pointerId = null;
            if (moved) {
                suppressClick = true;
                setTimeout(function () {
                    suppressClick = false;
                }, 0);
                row.classList.remove('gsp-dragging');
                if (performance.now() - lastTime < 80) {
                    momentumFrame = requestAnimationFrame(momentum);
                }
            }
        }

        row.addEventListener('pointerup', end);
        row.addEventListener('pointercancel', end);
        // A drag must not open the genre under the cursor.
        row.addEventListener('click', function (e) {
            if (suppressClick) {
                e.preventDefault();
                e.stopPropagation();
                suppressClick = false;
            }
        }, true);
        row.addEventListener('dragstart', function (e) {
            e.preventDefault();
        });
    }

    // Returns the element the section should follow (null = first child), or undefined when not known yet.
    function getAnchor(container, settings) {
        if (settings.Position === 'Bottom') {
            var last = container.lastElementChild;
            while (last && last.classList.contains(SECTION_CLASS)) {
                last = last.previousElementSibling;
            }
            return last;
        }
        if (settings.Position === 'AfterSection' && settings.PositionIndex > 0) {
            // Count only the home sections the user can actually see; empty ones (e.g. "Continue Watching"
            // without items) stay in the DOM but are hidden.
            var visible = [];
            for (var i = 0; i < container.children.length; i++) {
                var child = container.children[i];
                if (child.classList.contains(SECTION_CLASS) || !/(^|\s)section\d+(\s|$)/.test(child.className)
                    || child.classList.contains('hide') || !child.offsetHeight) {
                    continue;
                }
                visible.push({ el: child, order: parseInt(window.getComputedStyle(child).order, 10) || 0, index: i });
            }
            // Sort by what the user sees: CSS order first, then DOM position.
            visible.sort(function (x, y) {
                return x.order - y.order || x.index - y.index;
            });
            if (!visible.length) {
                return undefined;
            }
            var anchor = visible[Math.min(settings.PositionIndex, visible.length) - 1].el;
            return anchor;
        }
        return null;
    }

    // Moves the section to its configured place. Home sections load asynchronously (e.g. with the
    // Home Screen Sections plugin), so this runs again whenever the home screen changes.
    function ensurePlacement(container, section, settings) {
        var anchor = getAnchor(container, settings);
        if (anchor === undefined) {
            if (!section.parentNode) {
                container.insertBefore(section, container.firstChild);
            }
        } else if (anchor === null) {
            if (container.firstElementChild !== section) {
                container.insertBefore(section, container.firstChild);
            }
        } else if (anchor.nextElementSibling !== section) {
            anchor.insertAdjacentElement('afterend', section);
        }
        syncOrder(container, section, anchor);
    }

    // Some setups (e.g. the Home Screen Sections plugin) sort the home rows with CSS "order" instead of
    // DOM order. Give the section the same order value as the row it follows, so the DOM position decides.
    function syncOrder(container, section, anchor) {
        var order = '';
        if (anchor) {
            order = window.getComputedStyle(anchor).order;
        } else {
            var min = null;
            for (var i = 0; i < container.children.length; i++) {
                var child = container.children[i];
                if (child !== section) {
                    var value = parseInt(window.getComputedStyle(child).order, 10) || 0;
                    min = min === null ? value : Math.min(min, value);
                }
            }
            order = min === null || min === 0 ? '' : String(min);
        }
        if (order === '0') {
            order = '';
        }
        if (section.style.order !== order) {
            section.style.order = order;
        }
    }

    function findHomeContainer() {
        var containers = document.querySelectorAll('#indexPage #homeTab .sections.homeSectionsContainer');
        for (var i = 0; i < containers.length; i++) {
            if (!containers[i].closest('.hide')) {
                return containers[i];
            }
        }
        return containers[0] || null;
    }

    function render() {
        scheduled = false;
        var container = findHomeContainer();
        if (!container || pending) {
            return;
        }
        var client = getApiClient();
        if (!client) {
            return;
        }

        var existing = container.querySelector('.' + SECTION_CLASS);
        var key = cacheKey(client);
        if (existing && settingsCache && settingsCache.key === key && existing.getAttribute('data-settings') === JSON.stringify(settingsCache.value)) {
            ensurePlacement(container, existing, settingsCache.value);
            return;
        }

        injectStyles();
        pending = getSettings(client).then(function (settings) {
            var current = findHomeContainer();
            var old = current && current.querySelector('.' + SECTION_CLASS);
            var settingsJson = JSON.stringify(settings);
            if (old && old.getAttribute('data-settings') === settingsJson) {
                ensurePlacement(current, old, settings);
                return;
            }
            if (old) {
                old.remove();
            }
            if (!settings || !settings.Enabled) {
                return;
            }
            return loadData(client, settings).then(function (data) {
                // The home screen may have been re-rendered while we were loading.
                current = findHomeContainer();
                if (!current || current.querySelector('.' + SECTION_CLASS) || !data.list.length) {
                    return;
                }
                var section = buildSection(client, settings, data);
                section.setAttribute('data-settings', settingsJson);
                ensurePlacement(current, section, settings);
            });
        }).catch(function (err) {
            console.error('[GenreSection] failed to render', err);
        }).then(function () {
            pending = null;
        });
    }

    function schedule() {
        if (scheduled) {
            return;
        }
        scheduled = true;
        window.requestAnimationFrame(render);
    }

    // Reload the settings on every navigation, so changed settings apply when the home screen is shown again.
    function onNavigate() {
        settingsCache = null;
        schedule();
    }

    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    document.addEventListener('viewshow', onNavigate, true);
    schedule();
})();
