import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import L, {Map, TileLayer, Polyline, Control, CircleMarker, DivIcon, Icon, Marker, DomUtil} from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js";

// workaround stupid webkit limitation that can't do import ... with { type: "css" }
const importCss = async (url) => {
  const response = await fetch(url);
  if (response.ok) {
    const cssText = await response.text();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    document.adoptedStyleSheets.push(sheet);
  }
};

await Promise.all([
  importCss('https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css'),
  importCss(import.meta.resolve('./routeview.css'))
]);

let parentElement = null;
let trackPoints = [];
let breadCrumbsVisible = false; 
let bisector = null;
let quadtree = null; 

const map = {    
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
  element: null,
  control: null,
  route: null,
  breadCrumb: null
};

const chart = {       
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
  eventRect: null
};

const metersToMiles = (meters) => meters / 1609.344;

const metersToFeet = (meters) => meters * 3.28084;

const createMap = () => {

  const baseLayers = map.tileLayers.map(layer => new TileLayer(
    layer.url, { 
      attribution: layer.attribution, 
      maxZoom: layer.maxZoom,      
    })
  );

  map.control = new Map(map.element, {    
    layers: [baseLayers[0]],
    zoomControl: false
  });
  
  const layerControl = new Control.Layers();
  for (let i = 0; i < baseLayers.length; i++) {
    layerControl.addBaseLayer(baseLayers[i], map.tileLayers[i].name);  
  }
  layerControl.addTo(map.control);

  new Control.Zoom({ position: 'bottomright' })
    .addTo(map.control);

  new Control.Scale({ position: 'bottomleft' })
    .addTo(map.control);

  const logo = new Control({ position: 'topleft' });
  logo.onAdd = function () {
    const div = DomUtil.create('div');  
    //div.innerHTML= `<img class="df-logo" src="${import.meta.resolve('./df.png')}"/>`;
    div.innerHTML= `<img class="df-logo" />`;
    return div;
  }
  logo.addTo(map.control);

  setRouteLine();  
  setMarkers();
  
  map.control.on('pointermove', mapPointerMove);
  map.control.on('pointerout', mapPointerOut);
};

const setRouteLine = () => {  
  map.route = new Polyline(
    trackPoints.map(p => [p.y, p.x]), 
    { color: "#f00" }
  ).addTo(map.control);
  map.control.fitBounds(map.route.getBounds());
};

const setMarkers = () => {

  new Marker([trackPoints[0].y, trackPoints[0].x], { 
    icon: new DivIcon({
      className: 'df-start-icon',
      iconSize: [32, 32],
      iconAnchor: [31, 31]
    }),    
    riseOnHover: true    
  }).bindTooltip("Route Start").addTo(map.control);

  new Marker([trackPoints[trackPoints.length - 1].y, trackPoints[trackPoints.length - 1].x], { 
    icon: new DivIcon({
      className: 'df-end-icon',
      iconSize: [32, 32],
      iconAnchor: [1, 31]
    }),    
    riseOnHover: true    
  }).bindTooltip("Route End").addTo(map.control);
  
  map.breadCrumb = new CircleMarker([0, 0], { 
    radius: 6,     
    weight: 1, 
    color: "#000", 
    fillColor: "#fff", 
    fillOpacity: 1 
  }).addTo(map.control);  
};

const mapPointerOut = () => hideBreadcrumbs();

const mapPointerMove = (e) => {
    
  const layerPoint = map.control.latLngToLayerPoint(e.latlng);
  const closestPoint = map.route.closestLayerPoint(layerPoint);

  if (closestPoint.distance < 100) { 
    
    const latlng = map.control.layerPointToLatLng(closestPoint);      
    const point = quadtree.find(latlng.lng, latlng.lat);        
    const lineX = chart.xScale(point.d);
    const lineY = chart.yScale(point.e);   
    
    map.breadCrumb.setLatLng(latlng);
    chart.vLine.attr("x1", lineX).attr("x2", lineX);
    chart.hLine.attr("y1", lineY).attr("y2", lineY);     
    chart.toolTip
      .style("left", (lineX + chart.margin.left + 20) + "px")            
      .html(`${point.d.toFixed(1)} mi<br />${point.e.toFixed(0)} ft`);
                
    showBreadcrumbs();

  } else {    
    hideBreadcrumbs();
  }    
};

const createChart = () => {

  chart.svg = chart.div.append("svg")
    .attr("class", "df-elev-chart")    
    .attr("height", chart.height);
  
  chart.svgGroup = chart.svg 
    .append("g")
    .attr("transform", `translate(${chart.margin.left}, ${chart.margin.top})`);
  
  chart.pathFloor = d3.min(trackPoints, p => p.e);
  const max = d3.max(trackPoints, p => p.e);
  const ceiling = max - chart.pathFloor < chart.minFeet ? chart.pathFloor + chart.minFeet : max;
  const dataHeight = chart.height - chart.margin.top - chart.margin.bottom;

  // x scale/axis
  chart.xScale = d3.scaleLinear()
    .domain(d3.extent(trackPoints, p => p.d));
  
  chart.xAxis = chart.svgGroup.append("g")
    .attr("transform", `translate(0, ${dataHeight})`);

  // y scale/axis
  chart.yScale = d3.scaleLinear()
    .domain([chart.pathFloor, ceiling])
    .range([ dataHeight, 0 ]);

  chart.yAxis = chart.svgGroup.append("g")       
    .call(d3.axisLeft(chart.yScale).ticks(5));    
  
  chart.path = chart.svgGroup.append("path")
    .datum(trackPoints)
    .attr("class", "df-elev-path");
            
  chart.vLine = chart.svgGroup.append("line")
    .attr("class", "df-elev-line")        
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", dataHeight);

  chart.hLine = chart.svgGroup.append("line")
    .attr("class", "df-elev-line")
    .attr("x1", 0)
    .attr("y1", dataHeight)    
    .attr("y2", dataHeight);

  chart.toolTip = chart.div.append("div")
    .attr("class", "df-tooltip")
    .style("top", (chart.topOffset - chart.height + 20) + "px");

  // top-level invisible rectangle to handle mouse events
  chart.eventRect = chart.svgGroup.append("rect")    
    .attr("height", dataHeight)
    .attr("class", "df-elev-overlay")        
    .on('mouseover', showBreadcrumbs)
    .on("mousemove", chartMouseMove)
    .on('mouseout', hideBreadcrumbs);
  
  drawChart();  
};

const drawChart = () => {
   
  const parentWidth = parentElement.node().clientWidth;
  const dataWidth = parentWidth - chart.margin.left - chart.margin.right;
    
  chart.svg.attr("width", parentWidth);
  chart.xScale.range([ 0, dataWidth ]);
  chart.xAxis.call(d3.axisBottom(chart.xScale));
  chart.path.attr("d", d3.area()
      .x(p => chart.xScale(p.d))
      .y0(chart.yScale(chart.pathFloor))
      .y1(p => chart.yScale(p.e))      
    );
  chart.hLine.attr("x2", dataWidth);
  chart.eventRect.attr("width", dataWidth);  
};

const chartMouseMove = (e) => {
  const miles = chart.xScale.invert(e.offsetX - chart.margin.left);                                      
  const index = bisector(trackPoints, miles); 
  const feet = trackPoints[index] ? trackPoints[index].e : 0;

  chart.vLine
    .attr("x1", e.offsetX - chart.margin.left)
    .attr("x2", e.offsetX - chart.margin.left);

  chart.hLine
    .attr("y1", chart.yScale(feet))
    .attr("y2", chart.yScale(feet));

  chart.toolTip
    .style("left", (e.offsetX + 20) + "px")
    .html(`${miles.toFixed(1)} mi<br />${feet.toFixed(0)} ft`);
  
  const latlng = [trackPoints[index].y, trackPoints[index].x];
  map.breadCrumb.setLatLng(latlng);
  if (!map.control.getBounds().contains(latlng)) {
    map.control.panTo(latlng);
  }
};

const showBreadcrumbs = () => {
  if (!breadCrumbsVisible) {
    chart.toolTip.style("visibility", "visible");
    chart.vLine.style("visibility", "visible");
    chart.hLine.style("visibility", "visible");
    breadCrumbsVisible = true;
  }
};

const hideBreadcrumbs = () => {
  if (breadCrumbsVisible) {
    map.breadCrumb.setLatLng([0,0])
    chart.toolTip.style("visibility", "hidden");          
    chart.vLine.style("visibility", "hidden");
    chart.hLine.style("visibility", "hidden");
    breadCrumbsVisible = false;
  }
};

const renderViewer = (divId, routeId) => {
  
  parentElement = d3.select(`#${divId}`);  
  const parentHeight = parentElement.node().clientHeight;

  map.element = parentElement.append("div")
    .style("height", (parentHeight - chart.height) + "px")
    .node();

  chart.div = parentElement.append("div");
  chart.topOffset = parentHeight;
  
  fetch(`./routes/${routeId}.json`)
    .then(response => {
      return response.json();
    })
    .then(data => {
      
      trackPoints = data.route.track_points.map(p => ({ 
        x: p.x, 
        y: p.y, 
        e: metersToFeet(p.e), 
        d: metersToMiles(p.d)
      }));

      // get the data index, by distance
      bisector = d3.bisector(function (d) { return d.d; }).left;
      
      // find point by x, y
      quadtree = d3.quadtree().x(d => d.x).y(d => d.y).addAll(trackPoints);

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