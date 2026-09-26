/* Genre Section plugin – renders a row of genre thumbnails on the Jellyfin home screen. */
(function () {
    'use strict';

    if (window.__genreSectionPlugin) {
        return;
    }
    window.__genreSectionPlugin = true;

    var SECTION_CLASS = 'genreSectionPlugin';
    var SETTINGS_TTL = 60 * 1000;
    var DATA_TTL = 15 * 60 * 1000;
    var CANDIDATES_PER_GENRE = 12;

    var settingsCache = null; // { key, time, value }
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

    function movieWord(count) {
        var german = /^de/i.test(document.documentElement.lang || navigator.language || '');
        if (german) {
            return count === 1 ? 'Film' : 'Filme';
        }
        return count === 1 ? 'movie' : 'movies';
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
            + '.' + SECTION_CLASS + ' .gsp-wrap{position:relative;}'
            + '.' + SECTION_CLASS + ' .gsp-row{display:flex;gap:1em;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scroll-padding-inline:3.3%;'
            + 'padding-top:.6em;padding-bottom:.9em;scrollbar-width:none;-webkit-overflow-scrolling:touch;}'
            + '.' + SECTION_CLASS + ' .gsp-row::-webkit-scrollbar{display:none;}'
            + '.' + SECTION_CLASS + ' .gsp-card{position:relative;flex:0 0 auto;width:clamp(12em,21vw,19em);aspect-ratio:16/9;'
            + 'border-radius:.5em;overflow:hidden;scroll-snap-align:start;text-decoration:none;color:#fff;'
            + 'box-shadow:0 .2em .6em rgba(0,0,0,.35);transition:transform .18s ease,box-shadow .18s ease;outline:none;}'
            + '.' + SECTION_CLASS + ' .gsp-card:hover,.' + SECTION_CLASS + ' .gsp-card:focus{transform:scale(1.04);'
            + 'box-shadow:0 .4em 1.2em rgba(0,0,0,.5);}'
            + '.' + SECTION_CLASS + ' .gsp-card:focus-visible{box-shadow:0 0 0 .2em #00a4dc,0 .4em 1.2em rgba(0,0,0,.5);}'
            + '.' + SECTION_CLASS + ' .gsp-img{position:absolute;inset:0;background-size:cover;background-position:center;}'
            + '.' + SECTION_CLASS + ' .gsp-shade{position:absolute;inset:0;'
            + 'background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.75) 100%);}'
            + '.' + SECTION_CLASS + ' .gsp-name{position:absolute;left:.7em;right:.7em;bottom:.55em;font-size:1.25em;font-weight:600;'
            + 'text-shadow:0 1px 4px rgba(0,0,0,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
            + '.' + SECTION_CLASS + ' .gsp-count{display:block;font-size:.62em;font-weight:400;opacity:.85;}'
            + '.' + SECTION_CLASS + ' .gsp-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:2.2em;height:2.2em;'
            + 'border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:1.3em;cursor:pointer;opacity:0;'
            + 'transition:opacity .2s;display:flex;align-items:center;justify-content:center;}'
            + '.' + SECTION_CLASS + ' .gsp-wrap:hover .gsp-nav{opacity:1;}'
            + '.' + SECTION_CLASS + ' .gsp-prev{left:.3em;}.' + SECTION_CLASS + ' .gsp-next{right:.3em;}'
            + '.layout-tv .' + SECTION_CLASS + ' .gsp-nav,.layout-mobile .' + SECTION_CLASS + ' .gsp-nav{display:none;}';
        var style = document.createElement('style');
        style.id = 'genreSectionPluginStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------- data

    function getSettings(client) {
        var key = cacheKey(client);
        if (settingsCache && settingsCache.key === key && Date.now() - settingsCache.time < SETTINGS_TTL) {
            return Promise.resolve(settingsCache.value);
        }
        return client.getJSON(client.getUrl('GenreSection/Settings')).then(function (value) {
            settingsCache = { key: key, time: Date.now(), value: value };
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

    function pickImage(client, settings, x) {
        if (x.entry && x.entry.ImageUrl) {
            return resolveUrl(client, x.entry.ImageUrl);
        }
        var backdrops = x.info.backdrops;
        if (backdrops.length) {
            var pick = settings.RandomDefaultThumbs
                ? backdrops[Math.floor(Math.random() * backdrops.length)]
                : backdrops[0];
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
        var cards = data.list.map(function (x) {
            var name = (x.entry && x.entry.DisplayName) || x.genre.Name;
            var href = '#/list?genreId=' + encodeURIComponent(x.genre.Id) + '&serverId=' + encodeURIComponent(serverId);
            if (data.parentId) {
                href += '&parentId=' + encodeURIComponent(data.parentId);
            }
            var img = pickImage(client, settings, x);
            var hue = hashHue(x.genre.Name || '');
            var bg = 'background-image:linear-gradient(135deg,hsl(' + hue + ',55%,38%),hsl(' + ((hue + 50) % 360) + ',60%,18%));';
            if (img) {
                bg = 'background-image:url(\'' + img.replace(/'/g, '%27') + '\'),linear-gradient(135deg,hsl(' + hue + ',55%,38%),hsl('
                    + ((hue + 50) % 360) + ',60%,18%));';
            }
            var label = '';
            if (settings.ShowGenreName || !img) {
                label = '<div class="gsp-shade"></div><div class="gsp-name">' + escapeHtml(name)
                    + (x.info.count ? '<span class="gsp-count">' + x.info.count + ' ' + movieWord(x.info.count) + '</span>' : '')
                    + '</div>';
            }
            return '<a class="gsp-card focusable" data-genre="' + escapeHtml(x.genre.Name) + '" href="' + escapeHtml(href)
                + '" title="' + escapeHtml(name) + '"><div class="gsp-img" style="' + escapeHtml(bg) + '"></div>' + label + '</a>';
        }).join('');

        var section = document.createElement('div');
        section.className = 'verticalSection ' + SECTION_CLASS;
        section.innerHTML = ''
            + '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">'
            + '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(settings.SectionTitle || 'Genres') + '</h2>'
            + '</div>'
            + '<div class="gsp-wrap">'
            + '<button type="button" class="gsp-nav gsp-prev" aria-label="Previous">&#8249;</button>'
            + '<div class="gsp-row padded-left padded-right focuscontainer-x">' + cards + '</div>'
            + '<button type="button" class="gsp-nav gsp-next" aria-label="Next">&#8250;</button>'
            + '</div>';

        var row = section.querySelector('.gsp-row');
        section.querySelector('.gsp-prev').addEventListener('click', function () {
            row.scrollBy({ left: -row.clientWidth * 0.8, behavior: 'smooth' });
        });
        section.querySelector('.gsp-next').addEventListener('click', function () {
            row.scrollBy({ left: row.clientWidth * 0.8, behavior: 'smooth' });
        });
        return section;
    }

    function placeSection(container, section, settings) {
        if (settings.Position === 'Bottom') {
            container.appendChild(section);
            return;
        }
        if (settings.Position === 'AfterSection' && settings.PositionIndex > 0) {
            var anchor = container.querySelector('.section' + (settings.PositionIndex - 1));
            if (anchor) {
                anchor.insertAdjacentElement('afterend', section);
                return;
            }
        }
        container.insertBefore(section, container.firstChild);
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
        if (!container || container.querySelector('.' + SECTION_CLASS) || pending) {
            return;
        }
        var client = getApiClient();
        if (!client) {
            return;
        }

        injectStyles();
        pending = getSettings(client).then(function (settings) {
            if (!settings || !settings.Enabled) {
                return;
            }
            return loadData(client, settings).then(function (data) {
                // The home screen may have been re-rendered while we were loading.
                var current = findHomeContainer();
                if (!current || current.querySelector('.' + SECTION_CLASS) || !data.list.length) {
                    return;
                }
                placeSection(current, buildSection(client, settings, data), settings);
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

    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('hashchange', schedule);
    schedule();
})();
