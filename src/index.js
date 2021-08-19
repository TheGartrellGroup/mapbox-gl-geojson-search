'use strict';

import Choices from "choices.js/public/assets/scripts/choices";
import autoComplete from "@tarekraafat/autocomplete.js";
import interact from 'interactjs'
import { map as jsMap, get, isNil, isNumber, isObject, isString, uniqBy, pullAll } from 'lodash';
import BBOX from '@turf/bbox';

export default class MapboxSearch {
    constructor(options) {
        this.options = options;
        this.suggestions = {};
        this.highlightID = '_highlighted_search__';
        this.layerChanged = false;
        this.searchVisible = false;
        this.controlContainerClass = '_mapboxgl-search-ctrl__';
    }

    onAdd(map) {
        if (map && isObject(map)) {
            this._map = map;

            this.validateControlOptions();
            this.addInputObserver();
            this.createHighlightLayers();

            this._controlContainer = document.createElement('div');
            this._controlContainer.className = `mapboxgl-ctrl mapboxgl-ctrl-group ${this.controlContainerClass}`;

            //begin to add dom elements to search control
            this._container = document.createElement('div');
            this.addIdentifier(this.options.containerClass, this._container);
            this._map._container.appendChild(this._container);

            this._searchBtn = document.createElement('button');
            this.addIdentifier(this.options.btnID, this._searchBtn);
            this._controlContainer.appendChild(this._searchBtn);

            //event listener to toggle search
            this._searchBtn.addEventListener('click', () => {
                const elms = [this._container, this._searchBtn, this._selectSearch, this._input, this._layerPicker.containerOuter.element];
                elms.forEach(elm => elm.classList.toggle('active-search'));

                this.searchVisible = !this.searchVisible;

                if (this.searchVisible) {
                    this._input.focus();
                }
            });

            this._input = document.createElement('input');
            this._input.type = 'search';
            this._input.placeholder = this.options.placeholderText;
            this.addIdentifier(this.options.inputID, this._input);
            this._container.appendChild(this._input);

            this._selectSearch = document.createElement('select');
            this._selectSearch.id = 'mapbox-search-select';
            this._container.appendChild(this._selectSearch);

            return this._controlContainer;
        }
    }

    onRemove() {
        this._controlContainer.parentNode.removeChild(this._controlContainer);
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
            this.options.containerClass = `draggable ${elmName}-container`;
            elm.className = this.options.containerClass;
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
        //get unique set of categories   
        const cat = 'category';    
        this.uniqLyrCat = jsMap(uniqBy(this.options.layers, cat), cat);

        let layerDropdowns = [];
        let i = 0;

        //populate layers in layer picker dropdown
        for (const category of this.uniqLyrCat) {
            i++;
            let noCategory = isNil(category);
            let layerPickerOptions = {
                label: noCategory ? '' : category,
                id: i,
                disabled: false,
                choices: []
            }

            let layers = noCategory ? this.options.layers.filter(lyr => isNil(lyr.category)) : this.options.layers.filter(lyr => lyr.category === category);

            for (const lyr of layers) {
                let layerSelectConfig = {
                    value: lyr.displayName,
                    label: lyr.displayName
                }

                if (lyr.displayName === this.chosenLayer.displayName) {
                    layerSelectConfig.selected = true;
                }

                layerPickerOptions.choices.push(layerSelectConfig)
            }

            layerDropdowns.push(layerPickerOptions);
        }

        //instantiate searchable dropdown
        this._layerPicker = new Choices(`#${this._selectSearch.id}`, {
            //placeholder: true,
            maxItemCount: this.options.maxResults,
            searchFloor: 1,
            itemSelectText:'',
            renderChoiceLimit: 0,
            choices: layerDropdowns,
            fuseOptions: {
                threshold: 0.0
            }
        });

        const wrapper = document.getElementsByClassName('autoComplete_wrapper')[0];
        wrapper.appendChild(this._layerPicker.containerOuter.element);

        //trigger event when layer is change 
        //new layer data is loaded into autocomplete
        this._selectSearch.addEventListener('change', async (evt) => {
            this.layerChanged = true;
            this.previousLayer = this.chosenLayer;

            const val = evt.target.value;
            const newLyr = this.options.layers.filter(lyr => lyr.displayName === val)[0];

            await this.getLayerData(newLyr);
            this._typeahead.data = {
                src: this.suggestions.src,
                keys: this.suggestions.keys,
                filter: (list) => {
                    return this.typeaheadFilter(list)
                }
            }
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
                    if (isString(node.className) && node.className.includes(this.controlContainerClass)) {
                        observer.disconnect();

                        this._map.once('idle', () => {
                            this.populateData();

                            if (this.options.draggable) {
                                this.initDrag();
                            }
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
        this._controlContainer.style.display = 'initial';
    }

    //layer needs to be requested as raw geojson features
    //to offset search for features outside view port
    //as both map.queryRenderedFeatures and map.querySourceFeatures 
    //do not allow this ability
    async getLayerData(lyr) {
        this.chosenLayer = lyr;
        const props = ['source', 'displayName', 'id', 'category', 'type', 'uniqueFeatureID'];
        const layerSource = this._map.getSource(this.chosenLayer.source);
        const randomKey = Math.random().toString(36).substr(3, 2);
        const randomVal = Math.random().toString(36).substr(3, 4);
        const queryParam = `?x-${randomKey}=${randomVal}`;

        if (isNil(this.chosenLayer.uniqueFeatureID) || !this.chosenLayer.uniqueFeatureID.length) {
            throw new Error('options.uniqueFeatureID is required for every layer');
        }

        if (!isNil(this.chosenLayer.searchProperties) && !isNil(this.chosenLayer.excludedProperties)) {
            throw new Error('both options.searchProperties and options.excludedProperties cannot be included at the same time')
        }
        
        if (layerSource.type !== 'geojson') {
            throw new Error(`${source} layer is not a valid geojson`);
        } else if (!isNil(this.chosenLayer.dataPath) && isString(this.chosenLayer.dataPath)) {
            const response = await fetch(this.chosenLayer.dataPath+queryParam);
            this.currentData = await response.json();
        } else if (isString(layerSource._data)) {
            const response = await fetch(layerSource._data+queryParam);
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
        } else {
            this.suggestions.keys = Object.keys(items[0]);
        }
    }

    initDrag() {
        // target elements with the "draggable" class
        interact('.draggable')
            .draggable({
                // enable inertial throwing
                inertia: true,
                // keep the element within the area of it's parent
                modifiers: [
                    interact.modifiers.restrictRect({
                        restriction: 'parent',
                        endOnly: true
                    })
                ],
                autoScroll: false,
                listeners: {
                    // call this function on every dragmove event
                    move: dragMoveListener,
                }
            })

        function dragMoveListener(event) {
            var target = event.target
            // keep the dragged position in the data-x/data-y attributes
            var x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx
            var y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy

            // translate the element
            target.style.transform = 'translate(' + x + 'px, ' + y + 'px)'

            // update the posiion attributes
            target.setAttribute('data-x', x)
            target.setAttribute('data-y', y)
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
            data: {
                src: this.suggestions.src,
                keys: this.suggestions.keys,
                filter: (list) => {
                    return this.typeaheadFilter(list)
                }
            },
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
                maxResults: this.options.maxResults,
                noResults: true,
                element: (list, data) => {
                    //show a no results message
                    if (!data.results.length) {
                        const noResults = document.createElement("div");
                        noResults.setAttribute("class", "no-result");
                        noResults.innerHTML = `<span>No Results</span>`;
                        list.appendChild(noResults);
                    }
                }
            },
            events: {
                input: {
                    selection: (event) => {
                        this.highlighted = false;

                        if (this.layerChanged) {
                            this.clearPreviousHighlight();
                            this.layerChanged = false;
                        }

                        const selection = get(event.detail.selection.value, event.detail.selection.key);
                        this._typeahead.input.value = selection;
                        this._typeahead.input.blur();

                        this.identifyAndHiglight(selection, event.detail.selection.key);
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

    typeaheadFilter(list) {
        //dedupe results shown to user;
        return uniqBy(list, v => [v.key, v.match].join());
    }

    //highlight identified layer
    identifyAndHiglight(val, key) {

        //only zoom to highlighted feature if zoomOnSearch !== false
        if (this.chosenLayer.zoomOnSearch || isNil(this.chosenLayer.zoomOnSearch)) {
            const pitch = this._map.getPitch();
            const bearing = this._map.getBearing();
            const feats = this.currentData.features.filter(feat => feat.properties[key] === val);
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

        this._map.setFilter(`${this.chosenLayer.source}${this.highlightID}`, ['in', key, val]);
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