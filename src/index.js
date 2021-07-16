'use strict';

import autoComplete from "@tarekraafat/autocomplete.js";
import { map as jsMap, get, isBoolean, isNil, isNumber, isObject, isString, uniqBy,  } from 'lodash';
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
            this.addIdentifier(this.options.containerClass, this._container);

            this._input = document.createElement('input');
            this._input.type = 'search';
            this._input.placeholder = this.options.placeholderText;
            this.addIdentifier(this.options.inputID, this._input);
          
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

        const { 
            characterThreshold, containerClass, inputID, 
            layers, maxSuggest, placeholderText, 
            uniqueFeatureID
        } = this.options;
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
        const elmName = 'mapbox-search';

        if (isDiv) {
            this.options.containerClass = `${elmName}-container`;
            elm.className = `mapboxgl-ctrl ${this.options.containerClass}`;
        } else {
            this.options.inputID = `${elmName}-input`;
            elm.className = elmName;
            elm.id = this.options.inputID;
        }
        
        if (!isNil(customName) && (isString(customName) && customName.length)) {
            if (isDiv) {
                elm.classList.add(customName);
                this.optionsContainerClass += customName;
            } else {
                elm.id = customName;
                this.options.inputID = customName;
            } 
        }
    }

    createLayerDropdown() {
        this._selectSearch = document.createElement('select');
        this._selectSearch.className = 'mapbox-search-select';

        const cat = 'category';

        this.uniqLyrCat = jsMap(uniqBy(this.options.layers, cat), cat);
        this.layerDropwdowns = [];

        for (const category of this.uniqLyrCat) {
            let optGrp = document.createElement('optgroup');
            optGrp.setAttribute('label', category);

            let layers = this.options.layers.filter(lyr => lyr.category === category);

            for (const lyr of layers) {
                let opt = document.createElement('option');
                opt.value = lyr.displayName;
                opt.text = lyr.displayName;
                optGrp.appendChild(opt);
            }

            this._selectSearch.appendChild(optGrp);
        }

        const wrapper = document.getElementsByClassName('autoComplete_wrapper')[0];
        wrapper.appendChild(this._selectSearch);

        this._selectSearch.addEventListener('change', async (evt) => { 
            this.previousLayer = this.chosenLayer;

            const val = evt.target.value;
            const newLyr = this.options.layers.filter(lyr => lyr.displayName === val)[0];

            await this.getLayerData(newLyr);
            this._typeahead.data = this.suggestions;
        });

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
                    'circle-opacity': 0,
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
        const firstLyr = this.options.layers[0];
        await this.getLayerData(firstLyr);
        this.initTypeAhead();
        this.createLayerDropdown();
    }

    async getLayerData(lyr) {
        this.chosenLayer = lyr;
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
            let items = jsMap(this.currentData.features, item => item.properties);
            this.suggestions.src = items;
            this.suggestions.keys = this.chosenLayer.searchProperties;
        }

    }

    initTypeAhead() {
        const id = `#${this.options.inputID}`;

        //custom event listener to clear previous highlight
        //no apparent way with autcomplete.js API
        this._input.addEventListener('input', evt => {  
            if (this._input.value === '' && this.highlighted) {

                if (!isNil(this.previousLayer)) {
                    this._map.setFilter(`${this.previousLayer.source}${this.highlightID}`, ['in', this.highlightID, ''])
                }

                this._map.setFilter(`${this.chosenLayer.source}${this.highlightID}`, ['in', this.highlightID, ''])
            }
        });

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
                        this.highlighted = false;

                        const id = event.detail.selection.value[this.chosenLayer.uniqueFeatureID];
                        const selection = get(event.detail.selection.value, event.detail.selection.key);
                        this._typeahead.input.value = selection;
                        this._typeahead.input.blur();

                        this.identifyAndHiglight (id);
                    },
                    keydown: (event) => {
                        if (event.code === 'Enter' || event.key === 'Enter' || event.which === 13) {
                            this._typeahead.select(0);
                        }
                    },
                }
            }
        })
    }

    identifyAndHiglight (id) {
        if (this.chosenLayer.zoomOnSearch || isNil(this.chosenLayer.zoomOnSearch)) {
            const feat = this.currentData.features.filter(feat => feat.properties[this.chosenLayer.uniqueFeatureID] === id)[0];
            const bounds = bbox(feat);
    
            this._map.fitBounds(bounds, {
                padding: 100
            });
        }

        this._map.setFilter(`${this.chosenLayer.source}${this.highlightID}`, ['in', this.chosenLayer.uniqueFeatureID, id]);
        this.highlighted = true;
    }
}

if (window.mapboxgl) {
    mapboxgl.MapboxSearch = MapboxSearch;
} else if (typeof module !== 'undefined') {
    module.exports = MapboxSearch;
}