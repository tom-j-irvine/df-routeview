import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import L, {Map, TileLayer, Polyline, Control, CircleMarker} from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js";

import mapcss from "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css" with { type: "css" };
document.adoptedStyleSheets.push(mapcss);
import viewcss from './index.css' with { type: "css" };
document.adoptedStyleSheets.push(viewcss);

const _container = {
  width: 0,
  height: 0,
  points: []
}

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
  minFeet: 300
};

const metersToMiles = (meters) => meters / 1609.344;

const metersToFeet = (meters) => meters * 3.28084;

const drawMap = () => {
  
  // create base layers
  const baseLayers = _map.tileLayers.map(layer => new TileLayer(
    layer.url, { 
      attribution: layer.attribution, 
      maxZoom: layer.maxZoom
    })
  );

  _map.control = new Map(_map.divId, {
    zoom: 10,
    layers: [baseLayers[0]]
  });
  
  const layerControl = new Control.Layers();
  for (let i = 0; i < baseLayers.length; i++) {
    layerControl.addBaseLayer(baseLayers[i], _map.tileLayers[i].name);  
  }
  layerControl.addTo(_map.control);
  
  setRouteLine();  
  setBreadCrumb();

  // events  
  _map.control.on('pointermove', mapPointerMove);
  _map.control.on('pointerout', mapPointerOut);

};

const setRouteLine = () => {
  
  _map.route = new Polyline(
    _container.points.map(p => [p.y, p.x]), 
    { color: "#f00" }
  ).addTo(_map.control);

  _map.control.fitBounds(_map.route.getBounds());
};

const setBreadCrumb = () => {
  _map.breadCrumb = new CircleMarker([0, 0], { 
    radius: 6,     
    weight: 1, 
    color: "#000", 
    fillColor: "#fff", 
    fillOpacity: 1 
  }).addTo(_map.control);  
};

const mapPointerOut = () => _map.breadCrumb.setLatLng([0,0]);

const mapPointerMove = (e) => {
    
    const layerPoint = _map.control.latLngToLayerPoint(e.latlng);
    const closestPoint = _map.route.closestLayerPoint(layerPoint);

    if (closestPoint.distance < 100) { 
      const latlng = _map.control.layerPointToLatLng(closestPoint);  
      _map.breadCrumb.setLatLng(latlng);
    } else {
      _map.breadCrumb.setLatLng([0,0]);
    }    
};

const drawChart = (chartDiv) => {

  const svg = chartDiv.append("svg")
    .attr("class", "df-elev-chart")
    .attr("width", _container.width)
    .attr("height", _chart.height)    
    .append("g")
    .attr("transform",`translate(${_chart.margin.left}, ${_chart.margin.top})`);

  const dataWidth = _container.width - _chart.margin.left - _chart.margin.right;
  const dataHeight = _chart.height - _chart.margin.top - _chart.margin.bottom;

  const max = d3.max(_container.points, p => p.e);
  const floor = d3.min(_container.points, p => p.e);
  const ceiling = max - floor < _chart.minFeet ? floor + _chart.minFeet : max;

  // x axis
  const x = d3.scaleLinear()
    .domain(d3.extent(_container.points, p => p.d))
    .range([ 0, dataWidth ]);
  
  svg.append("g")
    .attr("transform", `translate(0, ${dataHeight})`)
    .call(d3.axisBottom(x));

  // y axis
  const y = d3.scaleLinear()
    .domain([floor, ceiling])
    .range([ dataHeight, 0 ]);

  svg.append("g")       
    .call(d3.axisLeft(y).ticks(5));    
  
  // plot the elevation
  svg.append("path")
    .datum(_container.points)
    .attr("class", "df-elev-path")
    .attr("d", d3.area()
      .x(p => x(p.d))
      .y0(y(floor))
      .y1(p => y(p.e))      
    );
            
    const vLine = svg.append("line")
      .attr("class", "df-elev-line")        
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", dataHeight);

    const hLine = svg.append("line")
      .attr("class", "df-elev-line")
      .attr("x1", 0)
      .attr("y1", dataHeight)
      .attr("x2", dataWidth)
      .attr("y2", dataHeight);

    const tooltip = chartDiv.append("div")
      .attr("class", "df-tooltip");

    // get the data index, by distance
    const bisect = d3.bisector(function (d) { return d.d; }).left;
    
    // top-level invisible rectangle to handle mouse events
    svg.append("rect")
      .attr("width", dataWidth)
      .attr("height", dataHeight)
      .attr("class", "df-elev-overlay")        
      .on('mouseover', () => { 
        tooltip.style("visibility", "visible");
        vLine.style("visibility", "visible");
        hLine.style("visibility", "visible");
      })       
      .on("mousemove", (e) => { 
        const miles = x.invert(e.offsetX - _chart.margin.left);                                      
        const index = bisect(_container.points, miles); 
        const feet = _container.points[index] ? _container.points[index].e : 0;

        vLine.attr("x1", e.offsetX - _chart.margin.left)
          .attr("x2", e.offsetX - _chart.margin.left);

        hLine.attr("y1", y(feet)).attr("y2", y(feet));

        tooltip.style("left", (e.offsetX + 20) + "px")
          .style("top", (e.offsetY + _container.height - _chart.height) + "px")            
          .html(`${miles.toFixed(1)} mi<br />${feet.toFixed(0)} ft`);

        // todo: hide breadcrumb when we leave the chart too
        const latlng = [_container.points[index].y, _container.points[index].x];
        _map.breadCrumb.setLatLng(latlng);
        if (!_map.control.getBounds().contains(latlng)) {
          _map.control.panTo(latlng);
        }
      })            
      .on('mouseout', () => {
        tooltip.style("visibility", "hidden");          
        vLine.style("visibility", "hidden");
        hLine.style("visibility", "hidden");
      });
};

const renderMap = (divId, routeId) => {
  
  const container = d3.select(`#${divId}`);  

  _container.width = container.node().clientWidth;
  _container.height = container.node().clientHeight;
  
  const map = container.append("div")
    .attr("id", _map.divId)
    .style("height", (_container.height - _chart.height) + "px");

  const chart = container.append("div");
  
  fetch(`./routes/${routeId}.json`)
    .then(response => {
      return response.json();
    })
    .then(data => {

      // get track points and convert meters to imperial
      _container.points = data.route.track_points.map(p => ({ 
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

export { renderMap };