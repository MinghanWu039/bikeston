// Set your Mapbox access token here
mapboxgl.accessToken =
  "pk.eyJ1IjoidHJhdmlzd3UiLCJhIjoiY203Zjh2MnZsMGxiODJrcTN3NzhrY25pMSJ9.vyqLGi1_l0lI92tlVn58nQ";

// Initialize the map
const map = new mapboxgl.Map({
  container: "map", // ID of the div where the map will render
  style: "mapbox://styles/mapbox/light-v11", // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 10, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString("en-US", { timeStyle: "short" }); // Format as HH:MM AM/PM
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

map.on("load", () => {
  let timeFilter = -1;
  const timeSlider = document.getElementById("time-slider");
  const selectedTime = document.getElementById("selected-time");
  const anyTimeLabel = document.getElementById("any-time");

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value); // Get slider value
    if (timeFilter === -1) {
      selectedTime.textContent = ""; // Clear time display
      anyTimeLabel.style.display = "block"; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = "none"; // Hide "(any time)"
    }

    // Trigger filtering logic which will be implemented in the next step
  }
  timeSlider.addEventListener("input", updateTimeDisplay);
  updateTimeDisplay();

  paint_style = {
    "line-color": "#2f8b4e", // A bright green using hex code
    "line-width": 3, // Thicker lines
    "line-opacity": 0.4, // Slightly less transparent
  };

  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...",
  });
  map.addSource("cambridge_route", {
    type: "geojson",
    data: " https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson?...",
  });

  map.addLayer({
    id: "bike-lanes-boston",
    type: "line",
    source: "boston_route",
    paint: paint_style,
  });

  map.addLayer({
    id: "bike-lanes-cambridge",
    type: "line",
    source: "cambridge_route",
    paint: paint_style,
  });

  // Load the nested JSON file
  const svg = d3.select("#map").select("svg");
  let stations = [];
  const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
  d3.json(jsonurl)
    .then((jsonData) => {
      console.log("Loaded JSON Data:", jsonData); // Log to verify structure
      stations = jsonData.data.stations;
      console.log("Stations Array:", stations);

      function getCoords(station) {
        const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
        const { x, y } = map.project(point); // Project to pixel coordinates
        return { cx: x, cy: y }; // Return as object for use in SVG attributes
      }

      // Load and process the traffic data
      const csvUrl =
        "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
      d3.csv(csvUrl)
        .then((trips) => {
          console.log("Loaded CSV Data:", trips); // Log to verify structure
          const arrivals = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.end_station_id
          );
          const departures = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.start_station_id
          );
          stations = stations.map((station) => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = arrivals.get(id) + departures.get(id) ?? 0;
            return station;
          });
          console.log(stations);

          const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range(timeFilter === -1 ? [0, 25] : [3, 50]);

         let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
         
          // Append circles to the SVG for each station
          const circles = svg
            .selectAll("circle")
            .data(stations)
            .enter()
            .append("circle")
            .attr("r", (d) => radiusScale(d.totalTraffic)) // Radius of the circle
            .attr("fill", "steelblue") // Circle fill color
            .attr("stroke", "white") // Circle border color
            .attr("stroke-width", 1) // Circle border thickness
            .attr("opacity", 0.5) // Circle opacity
            .each(function (d) {
              // Add <title> for browser tooltips
              d3.select(this)
                .append("title")
                .text(
                  `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                );
            });

          // Function to update circle positions when the map moves/zooms
          function updatePositions() {
            circles
              .attr("cx", (d) => getCoords(d).cx) // Set the x-position using projected coordinates
              .attr("cy", (d) => getCoords(d).cy); // Set the y-position using projected coordinates
          }

          updatePositions(); // Initial position update when map loads
          map.on("move", updatePositions); // Update during map movement
          map.on("zoom", updatePositions); // Update during zooming
          map.on("resize", updatePositions); // Update on window resize
          map.on("moveend", updatePositions); // Final adjustment after movement ends

          let departuresByMinute = Array.from({ length: 1440 }, () => []);
          let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

          for (let trip of trips) {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            let startedMinutes = minutesSinceMidnight(trip.started_at);
            departuresByMinute[startedMinutes].push(trip);
            let endedMinutes = minutesSinceMidnight(trip.ended_at);
            arrivalsByMinute[endedMinutes].push(trip);
          }

          function filterByMinute(tripsByMinute, minute) {
            // Normalize both to the [0, 1439] range
            // % is the remainder operator: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder
            let minMinute = (minute - 60 + 1440) % 1440;
            let maxMinute = (minute + 60) % 1440;
          
            if (minMinute > maxMinute) {
              let beforeMidnight = tripsByMinute.slice(minMinute);
              let afterMidnight = tripsByMinute.slice(0, maxMinute);
              return beforeMidnight.concat(afterMidnight).flat();
            } else {
              return tripsByMinute.slice(minMinute, maxMinute).flat();
            }
          }

          function filterTripsbyTime() {
            filtered_arrivals = filterByMinute(arrivalsByMinute, timeFilter);
            filtered_departures = filterByMinute(departuresByMinute, timeFilter);
            filtered_arrivals = d3.rollup(
                filtered_arrivals,
                (v) => v.length,
                (d) => d.end_station_id
                );
            filtered_departures = d3.rollup(
                filtered_departures,
                (v) => v.length,
                (d) => d.start_station_id
                );
            stations = stations.map((station) => {
              station = { ...station };
              let id = station.short_name;
              station.arrivals = filtered_arrivals.get(id) ?? 0;
              station.departures = filtered_departures.get(id) ?? 0;
              station.totalTraffic =
                filtered_arrivals.get(id) + filtered_departures.get(id) ?? 0;
              return station;
            });

            // Update the radius scale based on the filtered stations
            radiusScale.domain([0, d3.max(stations, (d) => d.totalTraffic)]);
            circles
              .data(stations)
              .transition()
              .attr("r", (d) => radiusScale(d.totalTraffic))
              .each(function (d) {
                d3.select(this)
                  .select("title")
                  .text(
                    `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
                  );
              })
              .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));
          }

          filterTripsbyTime();
          timeSlider.addEventListener("input", filterTripsbyTime);
        })
        .catch((error) => {
          console.error("Error loading CSV:", error); // Handle errors if CSV loading fails
        });
    })
    .catch((error) => {
      console.error("Error loading JSON:", error); // Handle errors if JSON loading fails
    });
});
