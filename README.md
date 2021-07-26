# mapbox-gl-geojson-search
A geojson feature search control for mapbox-gl-js.

## Local Development
```
npm i
npm run dev
```

## Usage
#### Control Options
`containerClass` __(String)__: class name for container _(optional)_

`inputID` __(String)__: id for input field _(optional)_

`btnID` __(String)__: id for control button _(optional)_

`characterThreshold` __(Number)__: number of characters before results are shown _(optional; defaults to 5)_

`maxResults` __(Number)__: maximum number of results shown for a given search _(optional; defaults to 5)_

`layers`__(Array{Object})__ : list of layers with associated properties required for search _(required)_
  * `source`__(String)__: source reference id  - ie. same as `map.addSource(id)` _(required)_
  * `displayName`__(String)__: name shown in layer picker _(required)_
  * `category`__(String)__: groups layers in picker by categories _(required)_
  * `type`__(String)__: feature type (i.e. 'polygon')  _(required)_
  * `uniqueFeatureID`__(String)__: unique identifier to identify search features - ideally unique per feature  _(required)_
  * `searchProperties`__(Array{String})__: search properties to include from geojson feature _(optional; cannot be used in conjuction with excludedProperties)_
  * `excludedProperties`__(Array{String})__: search properties to excluded from geojson feature _(optional; cannot be used in conjuction with searchProperties)_
  * `zoomOnSearch`__(Boolean)__: zooms to feature on select _(optional; defaults to true)_
  * `highlightColor`__(String)__: highlight color _(optional; defaults to yellow - '#ff0')_
  * `dataPath`__(String)__: url path to data - only neccessary when loading layers dynamically or if source is initially empty _(optional)_
  
#### Example
```javascript
  const searchControl = new mapboxgl.MapboxSearch({
    containerClass: 'search-container',
    inputID: 'search-box',
    btnID: 'search-btn',
    characterThreshold: 2,
    maxResults: 6, 
    layers: [
      {
        "source": "places",
        "displayName": "Places",
        "category": "Geo",
        "type": "polygon",
        "uniqueFeatureID": "adm0_a3",
        "searchProperties": ['name', 'name_long'],
        "zoomOnSearch": true,
        "highlightColor": '#ff0',
        "dataPath": 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_map_units.geojson'
      },
    ]
  });

  map.addControl(searchControl)
```
