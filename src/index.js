'use strict';

import autoComplete from "@tarekraafat/autocomplete.js";
import { isObject, isNil, isNumber, isString, map, get } from 'lodash';
import { bbox } from '@turf/turf';

export default class MapboxSearch {
    constructor(options) {
        this.options = options;
        this.suggestions = {};
        this.highlightID = '_highlighted_search__';
    }

    onAdd(map) {
        if (map && isObject(map)) {
            this._map = map;
            this.validateControlOptions();
            this.addInputObserver();
            this.createHighlightLayers();

            this._container = document.createElement('div');
            this._container.style.display = 'none';
            this.addIdentifier(this.options.containerClass, this._container);

            this._input = document.createElement('input');
            this._input.type = 'search';
            this._input.placeholder = this.options.placeholderText;
            this.addIdentifier(this.options.inputID, this._input);

            this._selectSearch = document.createElement('select');
            this._selectSearch.className = 'ctr-search-select';
            this._input.appendChild(this._selectSearch);

            this._container.appendChild(this._input);

            return this._container;
        }
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    // validate options passed by user
    validateControlOptions() {
        if (!isObject(this.options)) {
            throw new Error('options is not a valid object');
        }

        const { characterThreshold, containerClass, inputID, layers, maxSuggest, placeholderText, uniqueFeatureID } = this.options;
        const identifiers = [containerClass, inputID];
        const regexIdentifierCheck = /^\w+(-\w+)*$/;

        //containerClass
        //inputID
        identifiers.forEach(el => {
            if (!isNil(el) && !regexIdentifierCheck.test(el)) {
                throw new Error(`${el} is not a valid string for an identifier`);
            }
        });

        //maxSuggest
        if (isNil(maxSuggest)) {
            this.options.maxSuggest = 5;
        } else if (isNumber(maxSuggest)) {
            this.options.maxSuggest = Math.round(maxSuggest);
        } else {
            throw new Error(`${maxSuggest} is not a valid number for options.maxSuggest`);
        }

        //placeholderText
        if (isNil(placeholderText)) {
            this.options.placeholderText = 'Search...';
        }

        //characterThreshold
        if (isNil(characterThreshold)) {
            this.options.characterThreshold = 2;
        } else if (isNumber(characterThreshold)) {
            this.options.characterThreshold = Math.round(characterThreshold);
        } else {
            throw new Error(`${characterThreshold} is not a valid number for options.characterThreshold`);
        }

        //layers
        if (!isNil(layers) && !Array.isArray(layers)) {
            throw new Error('options.layers is not an array');
        }
    }

    addIdentifier(customName, elm) {
        const isDiv = elm.tagName === 'DIV';

        if (isNil(customName) || (isString(customName) && !customName.length)) {
            let elmName = 'mapbox-search';

            if (isDiv) {
                this.options.containerClass = `${elmName}-container`;
                elm.className = `mapboxgl-ctrl ${this.options.containerClass}`;
            } else {
                this.options.inputID = `${elmName}-input`;
                elm.id = this.options.inputID;
            }

        } else {
            isDiv ? elm.className = `mapboxgl-ctrl ${customName}` : elm.id = customName;
        }
    }

    createHighlightLayers() {

        for (const layer of this.options.layers) {
            const { highlightColor, source, type } = layer;

            let highlightLayerConfig = {
                'id': `${source}${this.highlightID}`,
                'source': source,
                'filter': ['in', this.highlightID, '']
            };

            if (type === 'polygon' || type === 'linestring' || type === 'line') {
                highlightLayerConfig.type = 'line';
                highlightLayerConfig.paint = {
                    'line-color': highlightColor || '#ff0',
                    'line-width': 5
                }
            } else {
                highlightLayerConfig.type = 'circle';
                highlightLayerConfig.paint = {
                    'circle-stroke-color': highlightColor || '#ff0',
                    'circle-stroke-width': 5
                }
            }

            this._map.addLayer(highlightLayerConfig)
        }

    }

    addInputObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.className.includes(this.options.containerClass)) {
                        this._container.style.display = 'initial';
                        this.populateData();
                        observer.disconnect();
                    }
                });
            });
        });

        const mapID = `#${this._map._container.id}`;
        observer.observe(document.querySelector(mapID), { subtree: true, childList: true });
    }

    async populateData() {
        await this.getLayerData();
        this.initTypeAhead();
    }

    async getLayerData() {
        this.chosenLayer = this.options.layers[0];
        const props = ['source', 'displayName', 'id', 'category', 'type', 'uniqueFeatureID'];
        const layerSource = this._map.getSource(this.chosenLayer.source);
 
        if (isNil(this.chosenLayer.uniqueFeatureID) || !this.chosenLayer.uniqueFeatureID.length) {
            throw new Error('options.uniqueFeatureID is required for every layer');
        }

        if (layerSource.type !== 'geojson') {
            throw new Error(`${source} layer is not a valid geojson`);
        } else if (isString(layerSource._data)) {
            const response = await fetch(layerSource._data);
            this.currentData = await response.json();
        } else {
            this.currentData = layerSource._data;
        }

        if (!isNil(this.chosenLayer.searchProperties) && Array.isArray(this.chosenLayer.searchProperties)) {
            let items = map(this.currentData.features, item => item.properties);
            this.suggestions.src = items;
            this.suggestions.keys = this.chosenLayer.searchProperties;
        }

    }

    initTypeAhead() {
        const id = `#${this.options.inputID}`;

        this._typeahead = new autoComplete({
            data: this.suggestions,
            threshold: this.options.characterThreshold,
            selector: id,
            submit: true,
            resultItem: {
                highlight: {
                    render: true
                }
            },
            events: {
                input: {
                    selection: (event) => {
                        const id = event.detail.selection.value[this.chosenLayer.uniqueFeatureID];
                        const selection = get(event.detail.selection.value, event.detail.selection.key);
                        this._typeahead.input.value = selection;
                        this._typeahead.input.blur();

                        this.zoomTo(id);
                    },
                    keydown: (event) => {
                        if (event.code === 'Enter' || event.key === 'Enter' || event.which === 13) {
                            this._typeahead.select(0);
                        }
                    }
                }
            }
        })
    }

    zoomTo(id) {
        const feat = this.currentData.features.filter(feat => feat.properties[this.chosenLayer.uniqueFeatureID] === id)[0];
        const bounds = bbox(feat);

        this._map.fitBounds(bounds, {
            padding: 100
        });

        this._map.setFilter(`${this.chosenLayer.source}${this.highlightID}`, ['in', this.chosenLayer.uniqueFeatureID, id]);
    }
}

if (window.mapboxgl) {
    mapboxgl.MapboxSearch = MapboxSearch;
} else if (typeof module !== 'undefined') {
    module.exports = MapboxSearch;
}