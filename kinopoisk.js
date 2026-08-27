(function() {
    'use strict';
    var network = new Lampa.Reguest();
    var PROFILE_LIMIT = 300;
    var skipNextUpdate = {};
    var PROFILES = {
        dima: {title: 'Дима', user: '372870', cache: 'kinopoisk_movies'},
        asya: {title: 'Ася', user: 'snosok', cache: 'kinopoisk_movies_asya'}
    };

    function activeProfile() {
        return Lampa.Storage.get('kinopoisk_profile', 'dima');
    }

    function profileMovies(profile) {
        if(profile !== 'common') return Lampa.Storage.get(PROFILES[profile].cache, []);

        var dimaMovies = Lampa.Storage.get(PROFILES.dima.cache, []);
        var asyaIds = {};
        Lampa.Storage.get(PROFILES.asya.cache, []).forEach(function(movie) {
            asyaIds[String(movie.kinopoisk_id)] = true;
        });

        return dimaMovies.filter(function(movie) {
            return asyaIds[String(movie.kinopoisk_id)];
        }).map(function(movie) {
            return Object.assign({}, movie, {kinopoisk_profiles: ['dima', 'asya']});
        });
    }

    function getRandomKinopoiskTechKey() {
        const keys = ['7cfaa892-27f7-473a-a44c-605af8d5a616', '8c8e1a50-6322-4135-8875-5d40a5420d86', 'f1d94351-2911-4485-b037-97817098724e', '0cb735ff-8ff0-4140-89f4-e638bd053a32'];
        const randomIndex = Math.floor(Math.random() * keys.length);
        return keys[randomIndex];
    }

    function stringifyError(data) {
        try {
            if (typeof data === 'string') return data;
            return JSON.stringify(data, Object.getOwnPropertyNames(data));
        } catch (e) {
            return String(data);
        }
    }

    function getTmdbBaseUrl() {
        return Lampa.Utils.protocol() + 'tmdb.' + Lampa.Manifest.cub_domain + '/3';
    }

    function getTmdbFallbackBaseUrl() {
        return 'https://api.themoviedb.org/3';
    }

    function requestTmdb(url, fallbackUrl, success, error) {
        console.log('Kinopoisk', 'TMDB request: ' + url);
        network.silent(url, success, function(data) {
            console.log('Kinopoisk', 'TMDB proxy error for ' + url + ', data: ' + stringifyError(data));
            if (fallbackUrl) {
                console.log('Kinopoisk', 'TMDB fallback request: ' + fallbackUrl);
                network.silent(fallbackUrl, success, function(fallbackData) {
                    console.log('Kinopoisk', 'TMDB fallback error for ' + fallbackUrl + ', data: ' + stringifyError(fallbackData));
                    error(fallbackData);
                });
            } else {
                error(data);
            }
        });
    }

    function calculateProgress(total, current, profile, sourceTotal, oncomplete, onprogress) {
        if(onprogress) onprogress();
        if(total == current) {
            var suffix = sourceTotal > total ? String(total) + ' из ' + String(sourceTotal) : String(total);
            Lampa.Noty.show(PROFILES[profile].title + ': обновление завершено (' + suffix + ')');
            if(oncomplete) oncomplete();
            if(Lampa.Storage.get('kinopoisk_launched_before', false) == false) {
                Lampa.Storage.set('kinopoisk_launched_before', true);
            }
        }
    }

    function movieKind(movie) {
        return movie.media_type === 'tv' || movie.first_air_date || movie.name ? 'tv' : 'movie';
    }

    function isAnimation(movie) {
        return (movie.genre_ids || []).some(function(id) {
            return Number(id) === 16;
        }) || (movie.genres || []).some(function(genre) {
            return Number(genre.id) === 16;
        });
    }

    function isWatched(movie) {
        var status = Lampa.Favorite.check(movie);
        return Boolean(status && (status.viewed || status.history));
    }

    function prepareMovies(movies, options) {
        var sort = Lampa.Storage.get('kinopoisk_sort', 'newest');
        var hideWatched = Lampa.Storage.get('kinopoisk_hide_watched', false);
        var result = movies.slice();

        if(options && options.filter) result = result.filter(options.filter);

        if(hideWatched && !(options && options.keepWatched)) result = result.filter(function(movie) {
            return !isWatched(movie);
        });

        result.sort(function(a, b) {
            var aOrder = typeof a.kinopoisk_order === 'number' ? a.kinopoisk_order : Number.MAX_SAFE_INTEGER;
            var bOrder = typeof b.kinopoisk_order === 'number' ? b.kinopoisk_order : Number.MAX_SAFE_INTEGER;
            if(sort === 'oldest') return bOrder - aOrder;
            if(sort === 'rating') return (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
            if(sort === 'title') {
                var aTitle = a.title || a.name || a.original_title || a.original_name || '';
                var bTitle = b.title || b.name || b.original_title || b.original_name || '';
                return aTitle.localeCompare(bTitle, 'ru');
            }
            return aOrder - bOrder;
        });

        return result;
    }

    function sectionMovies(movies, section) {
        if(section === 'movies') return prepareMovies(movies, {filter: function(movie) {
            return movieKind(movie) === 'movie' && !isAnimation(movie);
        }});
        if(section === 'series') return prepareMovies(movies, {filter: function(movie) {
            return movieKind(movie) === 'tv' && !isAnimation(movie);
        }});
        if(section === 'animation') return prepareMovies(movies, {filter: isAnimation});
        if(section === 'unwatched') return prepareMovies(movies, {
            keepWatched: true,
            filter: function(movie) {
                return !isWatched(movie);
            }
        });
        return prepareMovies(movies);
    }

    function dashboardRows(movies, profile) {
        var definitions = [
            {
                title: 'Фильмы',
                section: 'movies'
            },
            {
                title: 'Сериалы',
                section: 'series'
            },
            {
                title: 'Мультфильмы',
                section: 'animation'
            },
            {
                title: 'Непросмотренные',
                section: 'unwatched'
            }
        ];
        return definitions.map(function(definition) {
            var all = sectionMovies(movies, definition.section);
            return {
                title: definition.title,
                results: all.slice(0, 5).map(function(movie) {
                    var card = Object.assign({}, movie);
                    delete card.ready;
                    return card;
                }),
                more: all.length > 5,
                onMore: function() {
                    Lampa.Activity.push({
                        url: '',
                        title: definition.title,
                        component: 'kinopoisk',
                        section: definition.section,
                        profile: profile,
                        page: 1
                    });
                }
            };
        }).filter(function(row) {
            return row.results.length > 0;
        });
    }

    function refreshKinopoiskActivity() {
        var active = Lampa.Activity.active();
        var profile = activeProfile();
        delete skipNextUpdate[profile];
        if(active && active.component === 'kinopoisk') Lampa.Activity.replace({}, false);
    }

    function showProfileControls() {
        var selected = activeProfile();
        Lampa.Select.show({
            title: 'Кинопоиск: профиль',
            items: [
                {title: 'Дима', value: 'dima', selected: selected === 'dima'},
                {title: 'Ася', value: 'asya', selected: selected === 'asya'},
                {title: 'Общее', value: 'common', selected: selected === 'common'}
            ],
            onSelect: function(item) {
                Lampa.Storage.set('kinopoisk_profile', item.value);
                refreshKinopoiskActivity();
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    function showListControls() {
        var sort = Lampa.Storage.get('kinopoisk_sort', 'newest');
        var hideWatched = Lampa.Storage.get('kinopoisk_hide_watched', false);

        Lampa.Select.show({
            title: 'Кинопоиск: список',
            items: [
                {title: 'Сортировка', separator: true},
                {title: 'Новые сверху', setting: 'kinopoisk_sort', value: 'newest', selected: sort === 'newest'},
                {title: 'Старые сверху', setting: 'kinopoisk_sort', value: 'oldest', selected: sort === 'oldest'},
                {title: 'По рейтингу', setting: 'kinopoisk_sort', value: 'rating', selected: sort === 'rating'},
                {title: 'По названию', setting: 'kinopoisk_sort', value: 'title', selected: sort === 'title'},
                {title: 'Просмотренные', separator: true},
                {title: hideWatched ? 'Показывать просмотренные' : 'Скрыть просмотренные', setting: 'kinopoisk_hide_watched', value: !hideWatched}
            ],
            onSelect: function(item) {
                Lampa.Storage.set(item.setting, item.value);
                refreshKinopoiskActivity();
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    function processKinopoiskData(data, profile, oncomplete, onprogress) {
        // use cache
        if(data && data.data.userProfile && data.data.userProfile.userData && data.data.userProfile.userData.plannedToWatch) {
            var cacheKey = PROFILES[profile].cache;
            var kinopoiskMovies = Lampa.Storage.get(cacheKey, []);
            var allReceivedMovies = data.data.userProfile.userData.plannedToWatch.movies.items;
            var receivedMovies = allReceivedMovies.slice(0, PROFILE_LIMIT);
            var receivedMoviesCount = receivedMovies.length;
            var moviesCount = data.data.userProfile.userData.plannedToWatch.movies.total;
            console.log('Kinopoisk', "Total planned to watch movies found: " + String(moviesCount));
            console.log('Kinopoisk', "Movies received count: " + String(receivedMoviesCount));
            if(receivedMoviesCount == 0) {
                Lampa.Noty.show('В списке "Буду смотреть" Кинопоиска нет фильмов');
                if(oncomplete) oncomplete();
            }
            const receivedMovieIds = new Set(receivedMovies.map(m => String(m.movie.id)));
            const receivedMovieOrder = {};
            receivedMovies.forEach(function(item, index) {
                receivedMovieOrder[String(item.movie.id)] = index;
            });
            // filter out movies that are no longer present in receivedMovies
            kinopoiskMovies = kinopoiskMovies.filter(movie => receivedMovieIds.has(String(movie.kinopoisk_id)));
            kinopoiskMovies.forEach(function(movie) {
                movie.kinopoisk_order = receivedMovieOrder[String(movie.kinopoisk_id)];
            });
            Lampa.Storage.set(cacheKey, JSON.stringify(kinopoiskMovies));
            let processedItems = 1;
            receivedMovies.forEach(m => {
                const existsInLocalStorage = kinopoiskMovies.some(km => km.kinopoisk_id === String(m.movie.id));
                if (!existsInLocalStorage) {
                    // get movie data
                    var title = m.movie.title
                        ? (m.movie.title.localized || m.movie.title.original || String(m.movie.id))
                        : String(m.movie.id);
                    console.log('Kinopoisk', 'Getting details for movie: ' + String(m.movie.id) + ', movie title: ' + title);
                    // getting imdb id based on kinopoisk id
                    network.silent('https://kinopoiskapiunofficial.tech/api/v2.2/films/' + String(m.movie.id), function(data) {
                        if (data) {
                            var movieIMDBid = data.imdbId;
                            var movieTitle = data.nameOriginal ? data.nameOriginal : data.nameRu;
                            var movieType = data.type; // TV_SERIES or FILM
                            var movieYear = data.year;
                            if (movieIMDBid) {
                                console.log('Kinopoisk', 'IMDB movie id found: ' + String(movieIMDBid) + ' for kinopoisk id: ' + String(m.movie.id));
                                var urlPath = '/find/' + movieIMDBid + '?external_source=imdb_id&language=ru&api_key=4ef0d7355d9ffb5151e987764708ce96';
                            } else {
                                if (movieType === 'FILM') {
                                    console.log('Kinopoisk', 'No IMDB movie id found for kinopoisk id: ' + String(m.movie.id) + ', will search by movie title: ' + movieTitle);
                                    var urlPath = '/search/movie?query=' + encodeURIComponent(movieTitle) + '&api_key=4ef0d7355d9ffb5151e987764708ce96&year=' + String(movieYear) + '&language=ru';
                                } else { // TV_SERIES
                                    console.log('Kinopoisk', 'No IMDB movie id found for kinopoisk id: ' + String(m.movie.id) + ', will search by tv series title: ' + movieTitle);
                                    var urlPath = '/search/tv?query=' + encodeURIComponent(movieTitle) + '&api_key=4ef0d7355d9ffb5151e987764708ce96&year=' + String(movieYear) + '&language=ru';
                                }
                            }
                            var url = getTmdbBaseUrl() + urlPath;
                            var fallbackUrl = getTmdbFallbackBaseUrl() + urlPath;
                            // getting movie details
                            requestTmdb(url, fallbackUrl, function(data) {
                                if(data) {
                                    if (data.movie_results && data.movie_results[0]) {
                                        var movieItem = data.movie_results[0];
                                    } else if(data.tv_results && data.tv_results[0]) {
                                        var movieItem = data.tv_results[0];
                                    } else if(data.results && data.results[0]) {
                                        var movieItem = data.results[0];
                                    }
                                    if(movieItem) {

                                        // console.log('Kinopoisk', 'Movie details received: ' + JSON.stringify(movieItem));
                                        console.log('Kinopoisk', 'TMDB id found: ' + movieItem.id + ' for IMDB movie id: ' + movieIMDBid + ', kinopoisk id: ' + String(m.movie.id));

                                        var movieDateStr = movieItem.release_date || movieItem.first_air_date; // film or tv series
                                        var movieDate = new Date(movieDateStr);

                                        if (movieDate <= new Date()) {                                            
                                            movieItem.kinopoisk_id = String(m.movie.id);
                                            movieItem.kinopoisk_order = receivedMovieOrder[String(m.movie.id)];
                                            movieItem.media_type = movieItem.first_air_date || movieItem.name ? 'tv' : 'movie';
                                            movieItem.source = "tmdb";
                                            kinopoiskMovies = Lampa.Storage.get(cacheKey, []); // re-read data if another process modified it
                                            kinopoiskMovies.unshift(movieItem);
                                            Lampa.Storage.set(cacheKey, JSON.stringify(kinopoiskMovies));
                                        } else {
                                            console.log('Kinopoisk', 'Movie or TV with kinopoisk id ' + String(m.movie.id) + ' not released yet, release date:', movieDate);    
                                            if (Lampa.Storage.get('kinopoisk_add_to_favorites', false)) { // add to favorites
                                                Lampa.Favorite.add('wath', movieItem, 100);
                                            }
                                        }
                                        
                                    } else {
                                        console.log('Kinopoisk', 'No result found for ' + movieTitle + ', ' + movieYear, data);
                                    }
                                } else {
                                    console.log('Kinopoisk', 'No movie found by IMDB id: ' + String(movieIMDBid));
                                }
                                calculateProgress(receivedMoviesCount, processedItems++, profile, moviesCount, oncomplete, onprogress);
                            }, function(data) {
                                console.log('Kinopoisk', 'TMDB request failed, data: ' + stringifyError(data));
                                calculateProgress(receivedMoviesCount, processedItems++, profile, moviesCount, oncomplete, onprogress);
                            });
                        } else {
                            console.log('Kinopoisk', 'No movie found for kinopoisk id: ' + String(m.movie.id) + ', movie: ' + title);
                            calculateProgress(receivedMoviesCount, processedItems++, profile, moviesCount, oncomplete, onprogress);
                        }
                    }, function(data) {
                        console.log('Kinopoisk', 'kinopoiskapiunofficial error, data: ' + String(data));
                        calculateProgress(receivedMoviesCount, processedItems++, profile, moviesCount, oncomplete, onprogress);
                    }, false, {
                        type: 'get',
                        headers: {
                            'X-API-KEY': getRandomKinopoiskTechKey()
                        }
                    });
                } else {
                    console.log('Kinopoisk', 'Reading data from local storage for movie: ' + String(m.movie.id))
                    calculateProgress(receivedMoviesCount, processedItems++, profile, moviesCount, oncomplete, onprogress);
                }
            })
        } else {
            Lampa.Noty.show('Невозможно обработать данные, полученные от Кинопоиска');
            console.log('Kinopoisk', 'processKinopoiskData - ');
            console.log('Kinopoisk', data);
        }
    }

    function getKinopoiskData(profile, oncomplete, onerror, onprogress) {
        console.log('Kinopoisk', 'Starting to get Kinopoisk data for ' + PROFILES[profile].title + '...');
        network.silent('https://frigate.dimba.ru/kinopoisk/v1/planned?user=' + encodeURIComponent(PROFILES[profile].user), function(data) { // on success
            processKinopoiskData(data, profile, oncomplete, onprogress);
        }, function(data) { // on error
            console.log('Kinopoisk', 'Error, personal proxy', data);
            Lampa.Noty.show('Не удалось обновить список Кинопоиска');
            if(onerror) onerror();
        });
    }

    function loadProfileData(profile, oncomplete, onerror, onprogress) {
        var names = profile === 'common' ? ['dima', 'asya'] : [profile];
        var pending = names.length;
        names.forEach(function(name) {
            getKinopoiskData(name, function() {
                pending--;
                if(pending === 0 && oncomplete) oncomplete();
            }, function() {
                pending--;
                if(pending === 0) {
                    if(onerror) onerror();
                    else if(oncomplete) oncomplete();
                }
            }, onprogress);
        });
    }

    function full(params, oncomplete, onerror) {
        // https://github.com/yumata/lampa-source/blob/main/src/utils/reguest.js
        // https://github.com/yumata/lampa-source/blob/main/plugins/collections/api.js
        var profile = activeProfile() === 'common' ? 'dima' : activeProfile();
        getKinopoiskData(profile);
        oncomplete({
            "secuses": true,
            "page": 1,
            "results": prepareMovies(profileMovies(activeProfile()))
        });
    }

    function clear() {
        network.clear();
    }
    var Api = {
        full: full,
        clear: clear
    };

    function component(object) {
        if(object.section) {
            var category = new Lampa.InteractionCategory(object);
            category.create = function() {
                var profile = object.profile || activeProfile();
                var results = sectionMovies(profileMovies(profile), object.section).map(function(movie) {
                    var card = Object.assign({}, movie);
                    delete card.ready;
                    return card;
                });
                if(results.length) this.build({secuses: true, page: 1, results: results});
                else this.empty();
            };
            return category;
        }

        var comp = new Lampa.InteractionMain(object);
        comp.create = function() {
            var self = this;
            var profile = activeProfile();
            var built = false;
            var cachedRows = dashboardRows(profileMovies(profile), profile);
            if(cachedRows.length) {
                this.build(cachedRows);
                built = true;
            }

            if(skipNextUpdate[profile]) {
                delete skipNextUpdate[profile];
                if(!built) this.empty();
                return;
            }

            function renderProgress() {
                if(built || profileMovies(profile).length < 5) return;
                var rows = dashboardRows(profileMovies(profile), profile);
                if(rows.length) {
                    self.build(rows);
                    built = true;
                }
            }

            loadProfileData(profile, function() {
                if(!built) {
                    var rows = dashboardRows(profileMovies(profile), profile);
                    if(rows.length) self.build(rows);
                    else self.empty();
                } else {
                    var active = Lampa.Activity.active();
                    if(active && active.component === 'kinopoisk' && !active.section && activeProfile() === profile) {
                        skipNextUpdate[profile] = true;
                        Lampa.Activity.replace({}, false);
                    }
                }
            }, function() {
                if(!built) self.empty();
            }, renderProgress);
        };
        return comp;
    }
    // getting/refreshing oauth kinopoisk token
    function getToken(device_code, refresh) {
        var client_id = 'b8b9c7a09b79452094e12f6990009934';
        if(!refresh) {
            var token_data = {
                'grant_type': 'device_code',
                'code': device_code,
                'client_id': client_id,
                'client_secret': '0e7001e272944c05ae5a0df16e3ea8bd'
            }
        } else { // refresh token
            var token_data = {
                'grant_type': 'refresh_token',
                'refresh_token': device_code, // pass refresh token as device_code
                'client_id': client_id,
                'client_secret': '0e7001e272944c05ae5a0df16e3ea8bd'
            }
        }
        network.silent('https://oauth.yandex.ru/token', function(data) { // on token success
            if(data.access_token) {
                Lampa.Storage.set('kinopoisk_access_token', data.access_token);
                Lampa.Storage.set('kinopoisk_refresh_token', data.refresh_token);
                Lampa.Storage.set('kinopoisk_token_expires', data.expires_in * 1000 + Date.now());
                Lampa.Modal.close();
                getUserEmail();
                getKinopoiskData('dima');
            } else {
                Lampa.Noty.show('Не удалось получить token');
                console.log('Kinopoisk', 'Error during OAuth', data.error);
            }
        }, function(data) { // on token error
            Lampa.Noty.show(data.responseJSON.error_description);
            console.log('Kinopoisk', 'Token error', data);
        }, token_data);
    }
    // getting oauth user_code
    // https://yandex.ru/dev/id/doc/ru/codes/screen-code-oauth
    function getDeviceCode() {
        // generating unique device id
        const uuid4 = () => {
            const ho = (n, p) => n.toString(16).padStart(p, 0);
            const data = crypto.getRandomValues(new Uint8Array(16));
            data[6] = (data[6] & 0xf) | 0x40;
            data[8] = (data[8] & 0x3f) | 0x80;
            const view = new DataView(data.buffer);
            return `${ho(view.getUint32(0), 8)}${ho(view.getUint16(4), 4)}${ho(view.getUint16(6), 4)}${ho(view.getUint16(8), 4)}${ho(view.getUint32(10), 8)}${ho(view.getUint16(14), 4)}`; /// Compile the canonical textual form from the array data
        };
        Lampa.Storage.set('kinopoisk_deviceid', uuid4());
        var client_id = 'b8b9c7a09b79452094e12f6990009934';
        var device_code_data = {
            'client_id': client_id,
            'device_id': Lampa.Storage.get('kinopoisk_deviceid', '')
        }
        network.silent('https://oauth.yandex.ru/device/code', function(data) { // on device code success
            if(data.user_code && data.device_code) {
                // Lampa.Utils.copyTextToClipboard(data.user_code, ()=>{});
                // ask user to authorize
                let modal = $('<div><div class="about">Перейдите по ссылке https://ya.ru/device на любом устройстве и введите код<br><br><b>' + data.user_code + '</b><br><br></div><br><div class="broadcast__device selector" style="textalign: center">Готово</div></div>')
                Lampa.Modal.open({
                    title: 'Авторизация',
                    html: modal,
                    align: 'center',
                    onBack: () => {
                        Lampa.Modal.close()
                    },
                    onSelect: () => { // on button click
                        getToken(data.device_code, false);
                    }
                })
            } else {
                Lampa.Noty.show('Не удалось получить user_code');
                console.log('Kinopoisk', 'Failed to get user_code', data.error);
            }
        }, function(data) { // on device code error
            Lampa.Noty.show(data.responseJSON.error_description);
            console.log('Kinopoisk', 'Failed to get device code', data);
        }, device_code_data);
    }

    function getUserEmail() {
        network.silent('https://login.yandex.ru/info?format=json', function(data) {
            if (data.default_email) {
                Lampa.Storage.set('kinopoisk_email', data.default_email);

                $('div[data-name="kinopoisk_auth"]').find('.settings-param__name').text(data.default_email); // NOT WORKING?
            } else {
                Lampa.Noty.show('Не удалось получить email пользователя');
                console.log('Kinopoisk', 'Failed to get user email', data.error);                
            }
        }, function(data) { // on device code error
            Lampa.Noty.show(data.responseText);
            console.log('Kinopoisk', 'Failed to get user email', data);
        }, false, {
            type: 'get',
            headers: {
                'Authorization': 'OAuth ' + Lampa.Storage.get('kinopoisk_access_token')
            }
        });
        
    }


    function startPlugin() {
        var manifest = {
            type: 'video',
            version: '0.9.2',
            name: 'Кинопоиск',
            description: '',
            component: 'kinopoisk'
        };
        Lampa.Manifest.plugins = manifest;
        Lampa.Component.add('kinopoisk', component);
        function add() {
            var button = $("<li class=\"menu__item selector\">\n            <div class=\"menu__ico\">\n                <svg width=\"239\" height=\"239\" viewBox=\"0 0 239 239\" fill=\"currentColor\" xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\"><path fill=\"currentColor\" d=\"M215 121.415l-99.297-6.644 90.943 36.334a106.416 106.416 0 0 0 8.354-29.69z\" /><path fill=\"currentColor\" d=\"M194.608 171.609C174.933 197.942 143.441 215 107.948 215 48.33 215 0 166.871 0 107.5 0 48.13 48.33 0 107.948 0c35.559 0 67.102 17.122 86.77 43.539l-90.181 48.07L162.57 32.25h-32.169L90.892 86.862V32.25H64.77v150.5h26.123v-54.524l39.509 54.524h32.169l-56.526-57.493 88.564 46.352z\" /><path d=\"M206.646 63.895l-90.308 36.076L215 93.583a106.396 106.396 0 0 0-8.354-29.688z\" fill=\"currentColor\"/></svg>\n            </div>\n            <div class=\"menu__text\">".concat(manifest.name, "</div>\n        </li>"));
            button.on('hover:enter', function() {
                Lampa.Activity.push({
                    url: '',
                    title: manifest.name,
                    component: 'kinopoisk',
                    page: 1
                });
            });
            $('.menu .menu__list').eq(0).append(button);
            // $('.head__actions').eq(0).append(button);
        }
        if(window.appready) add();
        else {
            Lampa.Listener.follow('app', function(e) {
                if(e.type == 'ready') add();
            });
        }
        function addListControls() {
            $('#head_kinopoisk_controls').remove();
            $('#head_kinopoisk_profile').remove();
            var profileTitles = {dima: 'Дима', asya: 'Ася', common: 'Общее'};
            var profileButton = $('<div id="head_kinopoisk_profile" class="head__action selector" title="Профиль Кинопоиска"><span style="font-size: 0.72em; white-space: nowrap"></span></div>');
            var button = $('<div id="head_kinopoisk_controls" class="head__action selector" title="Сортировка и фильтры Кинопоиска"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M3 5h18v2H3V5zm3 6h12v2H6v-2zm4 6h4v2h-4v-2z"/></svg></div>');
            profileButton.on('hover:enter hover:click hover:touch', showProfileControls);
            button.on('hover:enter hover:click hover:touch', showListControls);
            $('.head__actions').append(profileButton).append(button);

            function toggle(event) {
                var active = event && event.object ? event.object : Lampa.Activity.active();
                var visible = Boolean(active && active.component === 'kinopoisk');
                profileButton.find('span').text(profileTitles[activeProfile()]);
                profileButton.toggle(visible);
                button.toggle(visible);
            }

            Lampa.Listener.follow('activity', toggle);
            toggle();
        }
        if(window.appready) addListControls();
        else Lampa.Listener.follow('app', function(e) {
            if(e.type == 'ready') addListControls();
        });
        // SETTINGS
        if(!window.lampa_settings.kinopoisk) { // re-use kinopoisk_ratings element, if exists
            Lampa.SettingsApi.addComponent({
                component: 'kinopoisk',
                icon: '<svg width=\"239\" height=\"239\" viewBox=\"0 0 239 239\" fill=\"currentColor\" xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\"><path fill=\"currentColor\" d=\"M215 121.415l-99.297-6.644 90.943 36.334a106.416 106.416 0 0 0 8.354-29.69z\" /><path fill=\"currentColor\" d=\"M194.608 171.609C174.933 197.942 143.441 215 107.948 215 48.33 215 0 166.871 0 107.5 0 48.13 48.33 0 107.948 0c35.559 0 67.102 17.122 86.77 43.539l-90.181 48.07L162.57 32.25h-32.169L90.892 86.862V32.25H64.77v150.5h26.123v-54.524l39.509 54.524h32.169l-56.526-57.493 88.564 46.352z\" /><path d=\"M206.646 63.895l-90.308 36.076L215 93.583a106.396 106.396 0 0 0-8.354-29.688z\" fill=\"currentColor\"/></svg>',
                name: 'Кинопоиск'
            });
        }
        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                name: 'kinopoisk_profile',
                type: 'select',
                values: {
                    dima: 'Дима',
                    asya: 'Ася',
                    common: 'Общее'
                },
                default: 'dima'
            },
            field: {
                name: 'Профиль'
            },
            onChange: refreshKinopoiskActivity
        });
        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                name: 'kinopoisk_sort',
                type: 'select',
                values: {
                    newest: 'Новые сверху',
                    oldest: 'Старые сверху',
                    rating: 'По рейтингу',
                    title: 'По названию'
                },
                default: 'newest'
            },
            field: {
                name: 'Сортировка списка'
            },
            onChange: refreshKinopoiskActivity
        });
        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                name: 'kinopoisk_hide_watched',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Скрывать просмотренные',
                description: 'Скрывает карточки из истории и отмеченные просмотренными'
            },
            onChange: refreshKinopoiskActivity
        });
        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                type: 'title'
            },
            field: {
                name: 'Mr.Voodoo · публичная папка, вход не требуется',
            }
        })

        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                type: 'title'
            },
            field: {
                name: 'Список Буду смотреть',
            }
        })
        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                name: 'kinopoisk_add_to_favorites',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Добавлять в Избранное',
                description: 'Будущие, еще не вышедшие релизы добавляются в список Позже'
            }
        })        
        Lampa.SettingsApi.addParam({
            component: 'kinopoisk',
            param: {
                type: 'button',
                name: 'kinopoisk_delete_cache'
            },
            field: {
                name: 'Очистить кэш фильмов',
                description: 'Необходимо при возникновении проблем'
            },
            onChange: () => {
                Lampa.Storage.set('kinopoisk_movies', []);
                Lampa.Storage.set('kinopoisk_movies_asya', []);
                Lampa.Noty.show('Кэш Кинопоиска очищен');
            }
        });        
    }
    if(!window.kinopoisk_ready) startPlugin();
})();
