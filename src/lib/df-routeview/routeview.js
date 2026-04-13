import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import L, {Map, TileLayer, Polyline, Control, CircleMarker, DivIcon, Icon, Marker, DomUtil} from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js";

//import mapcss from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css" with { type: "css" };
//document.adoptedStyleSheets.push(mapcss);
//import viewcss from './routeview.css' with { type: "css" };
//document.adoptedStyleSheets.push(viewcss);

// workaround stupid webkit limitation that can't do import ... with { type: "css" }
fetch('https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css')
  .then(response => {
    return response.text();
  }).then(cssText => { 
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    document.adoptedStyleSheets.push(sheet);
  });

fetch(import.meta.resolve('./routeview.css'))
  .then(response => {
    return response.text();
  }).then(cssText => { 
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    document.adoptedStyleSheets.push(sheet);
  });

let _containerDiv = null;
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
  topOffset: 0,
  div: null,
  svg: null,
  svgGroup: null,
  xScale: null,
  xAxis: null,
  yScale: null,
  yAxis: null,
  path: null,
  pathFloor: 0,
  toolTip: null,
  hLine: null,
  vLine: null,
  eventRect: null,
  bisector: null,
  quadtree: null
};

const metersToMiles = (meters) => meters / 1609.344;

const metersToFeet = (meters) => meters * 3.28084;

const createMap = () => {

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
  setMarkers();

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

const setMarkers = () => {

  new Marker([_points[0].y, _points[0].x], { 
    icon: new DivIcon({
      className: 'df-start-icon',
      iconSize: [32, 32],
      iconAnchor: [31, 31]
    }),    
    riseOnHover: true    
  }).bindTooltip("Route Start").addTo(_map.control);

  new Marker([_points[_points.length - 1].y, _points[_points.length - 1].x], { 
    icon: new DivIcon({
      className: 'df-end-icon',
      iconSize: [32, 32],
      iconAnchor: [1, 31]
    }),    
    riseOnHover: true    
  }).bindTooltip("Route End").addTo(_map.control);
  

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

const createChart = () => {

  _chart.svg = _chart.div.append("svg")
    .attr("class", "df-elev-chart")    
    .attr("height", _chart.height);
  
  _chart.svgGroup = _chart.svg 
    .append("g")
    .attr("transform", `translate(${_chart.margin.left}, ${_chart.margin.top})`);
  
  _chart.pathFloor = d3.min(_points, p => p.e);
  const max = d3.max(_points, p => p.e);
  const ceiling = max - _chart.pathFloor < _chart.minFeet ? _chart.pathFloor + _chart.minFeet : max;
  const dataHeight = _chart.height - _chart.margin.top - _chart.margin.bottom;

  // x scale/axis
  _chart.xScale = d3.scaleLinear()
    .domain(d3.extent(_points, p => p.d));
  
  _chart.xAxis = _chart.svgGroup.append("g")
    .attr("transform", `translate(0, ${dataHeight})`);

  // y scale/axis
  _chart.yScale = d3.scaleLinear()
    .domain([_chart.pathFloor, ceiling])
    .range([ dataHeight, 0 ]);

  _chart.yAxis = _chart.svgGroup.append("g")       
    .call(d3.axisLeft(_chart.yScale).ticks(5));    
  
  // plot the elevation
  _chart.path = _chart.svgGroup.append("path")
    .datum(_points)
    .attr("class", "df-elev-path");
            
  _chart.vLine = _chart.svgGroup.append("line")
    .attr("class", "df-elev-line")        
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", dataHeight);

  _chart.hLine = _chart.svgGroup.append("line")
    .attr("class", "df-elev-line")
    .attr("x1", 0)
    .attr("y1", dataHeight)    
    .attr("y2", dataHeight);

  _chart.toolTip = _chart.div.append("div")
    .attr("class", "df-tooltip")
    .style("top", (_chart.topOffset - _chart.height + 20) + "px");

  // top-level invisible rectangle to handle mouse events
  _chart.eventRect = _chart.svgGroup.append("rect")    
    .attr("height", dataHeight)
    .attr("class", "df-elev-overlay")        
    .on('mouseover', showBreadcrumbs)
    .on("mousemove", chartMouseMove)
    .on('mouseout', hideBreadcrumbs);
  
  drawChart();
  
};

const drawChart = () => {

  const container = d3.select(`#${_containerDiv}`);  
  const containerWidth = container.node().clientWidth;
  const dataWidth = containerWidth - _chart.margin.left - _chart.margin.right;
    
  _chart.svg.attr("width", containerWidth);
  _chart.xScale.range([ 0, dataWidth ]);
  _chart.xAxis.call(d3.axisBottom(_chart.xScale));
  _chart.path.attr("d", d3.area()
      .x(p => _chart.xScale(p.d))
      .y0(_chart.yScale(_chart.pathFloor))
      .y1(p => _chart.yScale(p.e))      
    );
  _chart.hLine.attr("x2", dataWidth);
  _chart.eventRect.attr("width", dataWidth);  

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
  
  _containerDiv = divId;

  const container = d3.select(`#${_containerDiv}`);  
  const containerHeight = container.node().clientHeight;
  
  // map div
  container.append("div")
    .attr("id", _map.divId)
    .style("height", (containerHeight - _chart.height) + "px");

  // chart div
  _chart.div = container.append("div");
  _chart.topOffset = containerHeight;
  
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

      // get the data index, by distance
      _chart.bisector = d3.bisector(function (d) { return d.d; }).left;
      
      // find point by x, y
      _chart.quadtree = d3.quadtree().x(d => d.x).y(d => d.y).addAll(_points);

      createMap();
      createChart();      
      // responsive resizing of chart
      window.onresize = drawChart;

    })
    .catch(error => {
      console.log(error);    
    });

};

export { renderViewer };