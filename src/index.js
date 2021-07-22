'use strict';

import autoComplete from "@tarekraafat/autocomplete.js";
import { map as jsMap, get, isNil, isNumber, isObject, isString, mapValues, uniqBy, pullAll } from 'lodash';
import '@fortawesome/fontawesome-free/js/all';
import BBOX from '@turf/bbox';

export default class MapboxSearch {
    constructor(options) {
        this.options = options;
        this.suggestions = {};
        this.highlightID = '_highlighted_search__';
        this.layerChanged = false;
        this.searchVisible = false;
    }

    onAdd(map) {
        if (map && isObject(map)) {
            this._map = map;

            this.validateControlOptions();
            this.addInputObserver();
            this.createHighlightLayers();

            //begin to add dom elements to search control
            this._container = document.createElement('div');
            this.addIdentifier(this.options.containerClass, this._container);

            this._searchBtn = document.createElement('button');
            this.addIdentifier(this.options.btnID, this._searchBtn);
            this._container.appendChild(this._searchBtn);

            //event listener to toggle search
            this._searchBtn.addEventListener('click', () => {
                const elms = [this._container, this._searchBtn, this._selectSearch, this._input];
                elms.forEach(elm => elm.classList.toggle('active-search'));

                this.searchVisible = !this.searchVisible;

                if (this.searchVisible) {
                    this._input.focus();
                }
            });

            this._searchBtnIcon = document.createElement('i');
            this._searchBtnIcon.className = 'fa fa-search';
            this._searchBtn.appendChild(this._searchBtnIcon);

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

    //validate custom options passed by user
    validateControlOptions() {
        if (!isObject(this.options)) {
            throw new Error('options is not a valid object');
        }

        const {
            btnID, characterThreshold, containerClass,
            inputID, layers, maxResults, placeholderText,
        } = this.options;
        const identifiers = [containerClass, inputID];
        const regexIdentifierCheck = /^\w+(-\w+)*$/;

        //containerClass
        //inputID
        //btnID
        identifiers.forEach(el => {
            if (!isNil(el) && !regexIdentifierCheck.test(el)) {
                throw new Error(`${el} is not a valid string for an identifier`);
            }
        });

        //maxResults
        if (isNil(maxResults)) {
            this.options.maxResults = 5;
        } else if (isNumber(maxResults)) {
            this.options.maxResults = Math.round(maxResults);
        } else {
            throw new Error(`${maxResults} is not a valid number for options.maxResults`);
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

    //add custom identifier to dom elements
    addIdentifier(customName, elm) {
        const isDiv = elm.tagName === 'DIV';
        const isInput = elm.tagName === 'INPUT';
        const isBtn = elm.tagName === 'BUTTON';

        const elmName = 'mapbox-search';

        if (isDiv) {
            this.options.containerClass = `${elmName}-container`;
            elm.className = `mapboxgl-ctrl mapboxgl-ctrl-group ${this.options.containerClass}`;
        } else if (isInput) {
            this.options.inputID = `${elmName}-input`;
            elm.className = elmName;
            elm.id = this.options.inputID;
        } else if (isBtn) {
            this.options.btnID = `${elmName}-btn`;
            elm.className = elmName;
            elm.id = this.options.btnID;
        }

        if (!isNil(customName) && (isString(customName) && customName.length)) {
            if (isDiv) {
                elm.classList.add(customName);
                this.optionsContainerClass += customName;
            } else {
                elm.id = customName;
                isInput ? this.options.inputID = customName : this.options.btnID = customName;
            }
        }
    }

    createLayerDropdown() {
        this._selectSearch = document.createElement('select');
        this._selectSearch.className = 'mapbox-search-select';

        const cat = 'category';

        //get unique set of layers
        this.uniqLyrCat = jsMap(uniqBy(this.options.layers, cat), cat);
        this.layerDropwdowns = [];

        //populate layers in layer picker dropdown
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

        //trigger event when layer is change 
        //new layer data is loaded into autocomplete
        this._selectSearch.addEventListener('change', async (evt) => {
            this.layerChanged = true;
            this.previousLayer = this.chosenLayer;

            const val = evt.target.value;
            const newLyr = this.options.layers.filter(lyr => lyr.displayName === val)[0];

            await this.getLayerData(newLyr);
            this._typeahead.data = this.suggestions;
        });

    }

    createHighlightLayers() {
        //check layer type to highlight polygon vs circle vs linestring
        for (const layer of this.options.layers) {
            const { dataPath, highlightColor, source, type } = layer;
            
            if (!isNil(dataPath) && isString(dataPath)) {
                this._map.getSource(source).setData(dataPath);
            }

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

    //mutation needed to populate autocomplete with layer data
    addInputObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.className.includes(this.options.containerClass)) {
                        observer.disconnect();

                        this._map.once('idle', () => {
                            this.populateData();
                        })
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
        this._container.style.display = 'initial';
    }

    //layer needs to be requested as raw geojson features
    //to offset search for features outside view port
    //as both map.queryRenderedFeatures and map.querySourceFeatures 
    //do not allow this ability
    async getLayerData(lyr) {
        this.chosenLayer = lyr;
        const props = ['source', 'displayName', 'id', 'category', 'type', 'uniqueFeatureID'];
        const layerSource = this._map.getSource(this.chosenLayer.source);

        if (isNil(this.chosenLayer.uniqueFeatureID) || !this.chosenLayer.uniqueFeatureID.length) {
            throw new Error('options.uniqueFeatureID is required for every layer');
        }

        if (!isNil(this.chosenLayer.searchProperties) && !isNil(this.chosenLayer.excludedProperties)) {
            throw new Error('both options.searchProperties and options.excludedProperties cannot be included at the same time')
        }

        if (layerSource.type !== 'geojson') {
            throw new Error(`${source} layer is not a valid geojson`);
        } else if (!isNil(this.chosenLayer.dataPath) && isString(this.chosenLayer.dataPath)) {
            const response = await fetch(this.chosenLayer.dataPath);
            this.currentData = await response.json();
        } else if (isString(layerSource._data)) {
            const response = await fetch(layerSource._data);
            this.currentData = await response.json();
        } else {
            this.currentData = layerSource._data;
        }

        let items = jsMap(this.currentData.features, item => item.properties);
        //replace null values with empty string
        this.suggestions.src = JSON.parse(JSON.stringify(items).replace(/\:null/gi, "\:\"\""));

        if (!isNil(this.chosenLayer.searchProperties) && Array.isArray(this.chosenLayer.searchProperties)) {
            this.suggestions.keys = this.chosenLayer.searchProperties;
        } else if (!isNil(this.chosenLayer.excludedProperties) && Array.isArray(this.chosenLayer.excludedProperties)) {
            let keys = Object.keys(items[0]);
            this.suggestions.keys = pullAll(keys, this.chosenLayer.excludedProperties);
        }
    }

    //initialize autocomplete/typeahead suggestion plugin
    initTypeAhead() {
        const id = `#${this.options.inputID}`;

        //custom event listener to identify 
        //if the input field has been cleared
        //no apparent way with autcomplete.js API
        this._input.addEventListener('input', evt => {
            if (this._input.value === '' && this.highlighted) {
                this.clearPreviousHighlight();
            }

            this._lastSearchedValue = this._input.value;
        });

        this._typeahead = new autoComplete({
            data: this.suggestions,
            threshold: this.options.characterThreshold,
            selector: id,
            submit: true,
            resultItem: {
                element: (item, data) => {
                    item.style = "display: flex; justify-content: space-between;";
                    //add attribute to right side of results
                    item.innerHTML = `
                        <span style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
                            ${data.match}
                        </span>
                        <span style="display: flex; align-items: center; font-size: 13px; font-weight: 300; color: rgba(0,0,0,.75);">
                            ${data.key}
                        </span>
                    `;
                },
                highlight: true
            },
            resultsList: {
                maxResults: this.options.maxResults
            },
            events: {
                input: {
                    selection: (event) => {
                        this.highlighted = false;

                        if (this.layerChanged) {
                            this.clearPreviousHighlight();
                            this.layerChanged = false;
                        }

                        //identify unique features by provided id
                        const id = event.detail.selection.value[this.chosenLayer.uniqueFeatureID];
                        const selection = get(event.detail.selection.value, event.detail.selection.key);
                        this._typeahead.input.value = selection;
                        this._typeahead.input.blur();

                        this.identifyAndHiglight(id);
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

    //highlight identified layer
    identifyAndHiglight(id) {
        //only zoom to highlighted feature if zoomOnSearch !== false
        if (this.chosenLayer.zoomOnSearch || isNil(this.chosenLayer.zoomOnSearch)) {
            const pitch = this._map.getPitch();
            const bearing = this._map.getBearing();
            const feats = this.currentData.features.filter(feat => feat.properties[this.chosenLayer.uniqueFeatureID] === id);
            const gj = {
                "type": "FeatureCollection",
                "features": feats
            }

            this._map.fitBounds(BBOX(gj), {
                pitch,
                bearing,
                padding: 100
            });
        }

        this._map.setFilter(`${this.chosenLayer.source}${this.highlightID}`, ['in', this.chosenLayer.uniqueFeatureID, id]);
        this.highlighted = true;
    }

    //remove prior highlight
    clearPreviousHighlight() {
        if (!isNil(this.previousLayer)) {
            this._map.setFilter(`${this.previousLayer.source}${this.highlightID}`, ['in', this.highlightID, ''])
        }

        this._map.setFilter(`${this.chosenLayer.source}${this.highlightID}`, ['in', this.highlightID, ''])
    }
}

if (window.mapboxgl) {
    mapboxgl.MapboxSearch = MapboxSearch;
} else if (typeof module !== 'undefined') {
    module.exports = MapboxSearch;
}