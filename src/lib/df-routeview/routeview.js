import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import L, {Map, TileLayer, Polyline, Control, CircleMarker, DomUtil} from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js";

import mapcss from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css" with { type: "css" };
document.adoptedStyleSheets.push(mapcss);
import viewcss from './routeview.css' with { type: "css" };
document.adoptedStyleSheets.push(viewcss);

let _containerHeight = 0;
let _containerWidth = 0;
let _points = [];
let _breadCrumbsVisible = false;

const _map = {
  divId: "p0ZoB1FwH6",    
  tileLayers: [
    {
      name: "USGS Topo",
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
      maxZoom: 20
    },
    {
      name: "USGS Imagery Topo",
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
      maxZoom: 20
    }
  ],
  control: null,
  route: null,
  breadCrumb: null
};

const _chart = {     
  height: 125,
  margin: { top: 10, right: 10, bottom: 20, left: 40 },
  minFeet: 300,
  xScale: null,
  yScale: null,
  toolTip: null,
  hLine: null,
  vLine: null,
  bisector: null,
  quadtree: null
};

const metersToMiles = (meters) => meters / 1609.344;

const metersToFeet = (meters) => meters * 3.28084;

const drawMap = () => {

  // create base layers
  const baseLayers = _map.tileLayers.map(layer => new TileLayer(
    layer.url, { 
      attribution: layer.attribution, 
      maxZoom: layer.maxZoom,      
    })
  );

  // map
  _map.control = new Map(_map.divId, {    
    layers: [baseLayers[0]],
    zoomControl: false
  });
  
  // layer control
  const layerControl = new Control.Layers();
  for (let i = 0; i < baseLayers.length; i++) {
    layerControl.addBaseLayer(baseLayers[i], _map.tileLayers[i].name);  
  }
  layerControl.addTo(_map.control);

  // zoom control
  new Control.Zoom({ position: 'bottomright' })
    .addTo(_map.control);

  // scale control
  new Control.Scale({ position: 'bottomleft' })
    .addTo(_map.control);

  // df logo
  const logo = new Control({ position: 'topleft' });
  logo.onAdd = function () {
    const div = DomUtil.create('div');  
    div.innerHTML= `<img class="df-logo" src="${import.meta.resolve('./df.png')}"/>`;
    return div;
  }
  logo.addTo(_map.control);

  setRouteLine();  
  setMapBreadCrumbs();

  // events  
  _map.control.on('pointermove', mapPointerMove);
  _map.control.on('pointerout', mapPointerOut);

};

const setRouteLine = () => {
  
  _map.route = new Polyline(
    _points.map(p => [p.y, p.x]), 
    { color: "#f00" }
  ).addTo(_map.control);

  _map.control.fitBounds(_map.route.getBounds());
};

const setMapBreadCrumbs = () => {
  _map.breadCrumb = new CircleMarker([0, 0], { 
    radius: 6,     
    weight: 1, 
    color: "#000", 
    fillColor: "#fff", 
    fillOpacity: 1 
  }).addTo(_map.control);  
};

const mapPointerOut = () => hideBreadcrumbs();

const mapPointerMove = (e) => {
    
  const layerPoint = _map.control.latLngToLayerPoint(e.latlng);
  const closestPoint = _map.route.closestLayerPoint(layerPoint);

  if (closestPoint.distance < 100) { 
    
    const latlng = _map.control.layerPointToLatLng(closestPoint);      
    const point = _chart.quadtree.find(latlng.lng, latlng.lat);        
    const lineX = _chart.xScale(point.d);
    const lineY = _chart.yScale(point.e);   
    
    _map.breadCrumb.setLatLng(latlng);
    _chart.vLine.attr("x1", lineX).attr("x2", lineX);
    _chart.hLine.attr("y1", lineY).attr("y2", lineY);     
    _chart.toolTip
      .style("left", (lineX + _chart.margin.left + 20) + "px")            
      .html(`${point.d.toFixed(1)} mi<br />${point.e.toFixed(0)} ft`);
                
    showBreadcrumbs();

  } else {
    // too far away from route
    hideBreadcrumbs();
  }    
};

const drawChart = (chartDiv) => {

  const svg = chartDiv.append("svg")
    .attr("class", "df-elev-chart")
    .attr("width", _containerWidth)
    .attr("height", _chart.height)    
    .append("g")
    .attr("transform",`translate(${_chart.margin.left}, ${_chart.margin.top})`);

  const dataWidth = _containerWidth - _chart.margin.left - _chart.margin.right;
  const dataHeight = _chart.height - _chart.margin.top - _chart.margin.bottom;

  const max = d3.max(_points, p => p.e);
  const floor = d3.min(_points, p => p.e);
  const ceiling = max - floor < _chart.minFeet ? floor + _chart.minFeet : max;

  // x axis
  _chart.xScale = d3.scaleLinear()
    .domain(d3.extent(_points, p => p.d))
    .range([ 0, dataWidth ]);
  
  svg.append("g")
    .attr("transform", `translate(0, ${dataHeight})`)
    .call(d3.axisBottom(_chart.xScale));

  // y axis
  _chart.yScale = d3.scaleLinear()
    .domain([floor, ceiling])
    .range([ dataHeight, 0 ]);

  svg.append("g")       
    .call(d3.axisLeft(_chart.yScale).ticks(5));    
  
  // plot the elevation
  svg.append("path")
    .datum(_points)
    .attr("class", "df-elev-path")
    .attr("d", d3.area()
      .x(p => _chart.xScale(p.d))
      .y0(_chart.yScale(floor))
      .y1(p => _chart.yScale(p.e))      
    );
            
    _chart.vLine = svg.append("line")
      .attr("class", "df-elev-line")        
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", dataHeight);

    _chart.hLine = svg.append("line")
      .attr("class", "df-elev-line")
      .attr("x1", 0)
      .attr("y1", dataHeight)
      .attr("x2", dataWidth)
      .attr("y2", dataHeight);

    _chart.toolTip = chartDiv.append("div")
      .attr("class", "df-tooltip")
      .style("top", (_containerHeight - _chart.height + 20) + "px");

    // get the data index, by distance
    _chart.bisector = d3.bisector(function (d) { return d.d; }).left;
    // find point by x, y
    _chart.quadtree = d3.quadtree().x(d => d.x).y(d => d.y).addAll(_points);
    
    // top-level invisible rectangle to handle mouse events
    svg.append("rect")
      .attr("width", dataWidth)
      .attr("height", dataHeight)
      .attr("class", "df-elev-overlay")        
      .on('mouseover', showBreadcrumbs)
      .on("mousemove", chartMouseMove)
      .on('mouseout', hideBreadcrumbs);
};

const chartMouseMove = (e) => {
  const miles = _chart.xScale.invert(e.offsetX - _chart.margin.left);                                      
  const index = _chart.bisector(_points, miles); 
  const feet = _points[index] ? _points[index].e : 0;

  _chart.vLine
    .attr("x1", e.offsetX - _chart.margin.left)
    .attr("x2", e.offsetX - _chart.margin.left);

  _chart.hLine
    .attr("y1", _chart.yScale(feet))
    .attr("y2", _chart.yScale(feet));

  _chart.toolTip
    .style("left", (e.offsetX + 20) + "px")
    .html(`${miles.toFixed(1)} mi<br />${feet.toFixed(0)} ft`);
  
  const latlng = [_points[index].y, _points[index].x];
  _map.breadCrumb.setLatLng(latlng);
  if (!_map.control.getBounds().contains(latlng)) {
    _map.control.panTo(latlng);
  }
};

const showBreadcrumbs = () => {
  if (!_breadCrumbsVisible) {
    _chart.toolTip.style("visibility", "visible");
    _chart.vLine.style("visibility", "visible");
    _chart.hLine.style("visibility", "visible");
    _breadCrumbsVisible = true;
  }
};

const hideBreadcrumbs = () => {
  if (_breadCrumbsVisible) {
    _map.breadCrumb.setLatLng([0,0])
    _chart.toolTip.style("visibility", "hidden");          
    _chart.vLine.style("visibility", "hidden");
    _chart.hLine.style("visibility", "hidden");
    _breadCrumbsVisible = false;
  }
};

const renderViewer = (divId, routeId) => {
  
  const container = d3.select(`#${divId}`);  

  _containerWidth = container.node().clientWidth;
  _containerHeight = container.node().clientHeight;
  
  const map = container.append("div")
    .attr("id", _map.divId)
    .style("height", (_containerHeight - _chart.height) + "px");

  const chart = container.append("div");
  
  fetch(`./routes/${routeId}.json`)
    .then(response => {
      return response.json();
    })
    .then(data => {

      // get track points and convert meters to imperial
      _points = data.route.track_points.map(p => ({ 
        x: p.x, 
        y: p.y, 
        e: metersToFeet(p.e), 
        d: metersToMiles(p.d)
      }));

      drawMap();
      drawChart(chart);
    })
    .catch(error => {
      console.log(error);    
    });

};

export { renderViewer };