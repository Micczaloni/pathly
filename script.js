'use strict';

import {
  LeafletMap,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  LatLngBounds,
  CircleMarker,
} from 'leaflet';

const STORAGE_KEY = 'pathly-workouts';
const WARSAW = [52.2297, 21.0122];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

///////////////////////////////////////
// WORKOUT MODEL
class Workout {
  date = new Date();
  id = crypto.randomUUID().slice(0, 10);
  clicks = 0;
  place = '';
  weather = null;
  path = null;

  constructor(coords, distance, duration) {
    this.coords = coords;
    this.distance = distance;
    this.duration = duration;
  }

  _setDescription() {
    this.description = `${this.type[0].toUpperCase()}${this.type.slice(1)} on ${
      MONTHS[this.date.getMonth()]
    } ${this.date.getDate()}`;
  }

  click() {
    this.clicks++;
  }
}

class Running extends Workout {
  type = 'running';

  constructor(coords, distance, duration, cadence, extras = {}) {
    super(coords, distance, duration);
    this.cadence = cadence;
    Object.assign(this, extras);
    this.date = new Date(this.date);
    this.calcPace();
    this._setDescription();
  }

  calcPace() {
    this.pace = this.duration / this.distance;
    return this.pace;
  }
}

class Cycling extends Workout {
  type = 'cycling';

  constructor(coords, distance, duration, elevationGain, extras = {}) {
    super(coords, distance, duration);
    this.elevationGain = elevationGain;
    Object.assign(this, extras);
    this.date = new Date(this.date);
    this.calcSpeed();
    this._setDescription();
  }

  calcSpeed() {
    this.speed = this.distance / (this.duration / 60);
    return this.speed;
  }
}

///////////////////////////////////////
// UI HELPERS
const form = document.querySelector('.form');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDistance = document.querySelector('.form__input--distance');
const inputDuration = document.querySelector('.form__input--duration');
const inputCadence = document.querySelector('.form__input--cadence');
const inputElevation = document.querySelector('.form__input--elevation');
const sortSelect = document.getElementById('sort');
const toastStack = document.getElementById('toast-stack');
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmText = document.getElementById('confirm-text');
const drawHint = document.getElementById('draw-hint');
const btnDraw = document.getElementById('btn-draw');
const btnFit = document.getElementById('btn-fit');
const btnClear = document.getElementById('btn-clear');
const btnFinishDraw = document.getElementById('btn-finish-draw');
const btnCancelDraw = document.getElementById('btn-cancel-draw');
const btnCancelForm = document.getElementById('btn-cancel-form');

const weatherLabel = code => {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 67) return 'Rainy';
  if (code <= 77) return 'Snowy';
  if (code <= 82) return 'Showers';
  if (code <= 99) return 'Stormy';
  return 'Weather n/a';
};

///////////////////////////////////////
// APP
class App {
  #map;
  #mapZoomLevel = 13;
  #mapEvent;
  #workouts = [];
  #markers = new Map();
  #paths = new Map();
  #editingId = null;
  #drawing = false;
  #drawPoints = [];
  #drawPreview = null;
  #tempMarkers = [];
  #sort = 'date-desc';

  constructor() {
    this._getLocalStorage();
    this._loadMap(WARSAW);

    form.addEventListener('submit', this._submitWorkout.bind(this));
    inputType.addEventListener('change', this._toggleElevationField);
    containerWorkouts.addEventListener('click', this._onWorkoutListClick.bind(this));
    sortSelect.addEventListener('change', e => {
      this.#sort = e.target.value;
      this._renderWorkoutList();
    });
    btnFit.addEventListener('click', this._fitToWorkouts.bind(this));
    btnClear.addEventListener('click', this._deleteAllWorkouts.bind(this));
    btnDraw.addEventListener('click', this._toggleDrawMode.bind(this));
    btnFinishDraw.addEventListener('click', this._finishDraw.bind(this));
    btnCancelDraw.addEventListener('click', this._cancelDraw.bind(this));
    btnCancelForm.addEventListener('click', () => this._hideForm());
  }

  _toast(message, type = 'ok', title = '') {
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `
      <span class="toast__dot"></span>
      <p class="toast__text">${title ? `<strong>${title}</strong>` : ''}${message}</p>
    `;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  async _confirm(title, text) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmModal.showModal();
    return new Promise(resolve => {
      const onClose = () => {
        confirmModal.removeEventListener('close', onClose);
        resolve(confirmModal.returnValue === 'confirm');
      };
      confirmModal.addEventListener('close', onClose);
    });
  }

  _loadMap(coords = WARSAW) {
    this.#map = new LeafletMap('map');
    this.#map.setView(coords, this.#mapZoomLevel);

    new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.#map);

    this.#map.on('click', this._onMapClick.bind(this));
    this.#map.on('dblclick', e => {
      if (!this.#drawing) return;
      e.originalEvent?.preventDefault?.();
      this._finishDraw();
    });

    this.#workouts.forEach(work => this._renderWorkoutMarker(work));
    this._renderWorkoutList();
    if (this.#workouts.length) this._fitToWorkouts(false);
  }

  _normalizeCoords(coords) {
    const lat = Number(coords?.[0]);
    const lng = Number(coords?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }

  _moveToWorkout(workout) {
    if (!this.#map || !workout) return;

    const coords = this._normalizeCoords(workout.coords);
    if (!coords) return;

    document
      .querySelectorAll('.workout.is-active')
      .forEach(el => el.classList.remove('is-active'));
    document
      .querySelector(`.workout[data-id="${CSS.escape(String(workout.id))}"]`)
      ?.classList.add('is-active');

    if (typeof this.#map.flyTo === 'function') {
      this.#map.flyTo(coords, this.#mapZoomLevel, { duration: 0.85 });
    } else {
      this.#map.setView(coords, this.#mapZoomLevel);
    }

    const marker = this.#markers.get(workout.id);
    if (marker) {
      setTimeout(() => marker.openPopup(), 300);
    }

    workout.click?.();
  }

  _onMapClick(mapE) {
    if (this.#drawing) {
      this._addDrawPoint(mapE.latlng);
      return;
    }
    this.#mapEvent = mapE;
    this.#editingId = null;
    this._showForm();
  }

  _toggleDrawMode() {
    if (this.#drawing) {
      this._cancelDraw();
      return;
    }
    this.#drawing = true;
    this.#drawPoints = [];
    this.#map?.doubleClickZoom.disable();
    btnDraw.classList.add('is-active');
    drawHint.hidden = false;
    this._hideForm(true);
    this._toast('Click the map to place route points.', 'ok', 'Draw mode');
  }

  _addDrawPoint(latlng) {
    this.#drawPoints.push([latlng.lat, latlng.lng]);
    const dot = new CircleMarker(latlng, {
      radius: 6,
      color: '#3dffb5',
      fillColor: '#3dffb5',
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(this.#map);
    this.#tempMarkers.push(dot);
    this._updateDrawPreview();
  }

  _updateDrawPreview() {
    if (this.#drawPreview) this.#map.removeLayer(this.#drawPreview);
    if (this.#drawPoints.length < 2) return;
    this.#drawPreview = new Polyline(this.#drawPoints, {
      color: '#3dffb5',
      weight: 4,
      opacity: 0.85,
      dashArray: '8 8',
    }).addTo(this.#map);
  }

  _clearDrawLayers() {
    this.#tempMarkers.forEach(m => this.#map.removeLayer(m));
    this.#tempMarkers = [];
    if (this.#drawPreview) {
      this.#map.removeLayer(this.#drawPreview);
      this.#drawPreview = null;
    }
  }

  _cancelDraw() {
    this.#drawing = false;
    this.#drawPoints = [];
    this._clearDrawLayers();
    this.#map?.doubleClickZoom.enable();
    btnDraw.classList.remove('is-active');
    drawHint.hidden = true;
  }

  _finishDraw() {
    if (this.#drawPoints.length < 2) {
      this._toast('Add at least two points for a route.', 'warn', 'Almost there');
      return;
    }
    const last = this.#drawPoints[this.#drawPoints.length - 1];
    this.#mapEvent = { latlng: { lat: last[0], lng: last[1] } };
    this.#editingId = null;
    form.dataset.path = JSON.stringify(this.#drawPoints);
    this._clearDrawLayers();
    this.#drawing = false;
    this.#map?.doubleClickZoom.enable();
    btnDraw.classList.remove('is-active');
    drawHint.hidden = true;
    this._showForm();
  }

  _showForm() {
    form.classList.remove('hidden');
    inputDistance.focus();
  }

  _hideForm(skipResetPath = false) {
    inputDistance.value =
      inputDuration.value =
      inputCadence.value =
      inputElevation.value =
        '';
    this.#editingId = null;
    if (!skipResetPath) delete form.dataset.path;
    form.classList.add('hidden');
  }

  _toggleElevationField() {
    inputElevation.closest('.form__row').classList.toggle('form__row--hidden');
    inputCadence.closest('.form__row').classList.toggle('form__row--hidden');
  }

  _validInputs(...inputs) {
    return inputs.every(inp => Number.isFinite(inp));
  }

  _allPositive(...inputs) {
    return inputs.every(inp => inp > 0);
  }

  async _submitWorkout(e) {
    e.preventDefault();

    const type = inputType.value;
    const distance = +inputDistance.value;
    const duration = +inputDuration.value;
    let workout;

    if (type === 'running') {
      const cadence = +inputCadence.value;
      if (!this._validInputs(distance, duration, cadence) || !this._allPositive(distance, duration, cadence)) {
        this._toast('Distance, duration and cadence must be positive numbers.', 'error', 'Invalid input');
        return;
      }
    }

    if (type === 'cycling') {
      const elevation = +inputElevation.value;
      if (
        !this._validInputs(distance, duration, elevation) ||
        !this._allPositive(distance, duration)
      ) {
        this._toast('Distance and duration must be positive. Elevation can be any number.', 'error', 'Invalid input');
        return;
      }
    }

    if (this.#editingId) {
      await this._updateExistingWorkout(type, distance, duration);
      return;
    }

    const { lat, lng } = this.#mapEvent.latlng;
    const path = form.dataset.path ? JSON.parse(form.dataset.path) : null;

    if (type === 'running') {
      workout = new Running([lat, lng], distance, duration, +inputCadence.value, { path });
    } else {
      workout = new Cycling([lat, lng], distance, duration, +inputElevation.value, { path });
    }

    this.#workouts.push(workout);
    this._renderWorkoutMarker(workout);
    this._renderWorkoutList();
    this._hideForm();
    this._setLocalStorage();
    this._toast('Workout saved to your map.', 'ok', 'Nice!');
    this._enrichWorkout(workout);
  }

  async _updateExistingWorkout(type, distance, duration) {
    const idx = this.#workouts.findIndex(w => w.id === this.#editingId);
    if (idx === -1) return;

    const old = this.#workouts[idx];
    const extras = {
      id: old.id,
      date: old.date,
      place: old.place,
      weather: old.weather,
      path: old.path,
      clicks: old.clicks,
    };

    let workout;
    if (type === 'running') {
      workout = new Running(old.coords, distance, duration, +inputCadence.value, extras);
    } else {
      workout = new Cycling(old.coords, distance, duration, +inputElevation.value, extras);
    }

    this._removeMapLayers(old.id);
    this.#workouts[idx] = workout;
    this._renderWorkoutMarker(workout);
    this._renderWorkoutList();
    this._hideForm();
    this._setLocalStorage();
    this._toast('Workout updated.', 'ok', 'Saved');
  }

  async _enrichWorkout(workout) {
    try {
      const [place, weather] = await Promise.all([
        this._fetchPlace(workout.coords),
        this._fetchWeather(workout.coords),
      ]);
      workout.place = place;
      workout.weather = weather;
      this._setLocalStorage();
      this._renderWorkoutList();
      this._refreshMarkerPopup(workout);
    } catch {
      // Non-blocking enrichment
    }
  }

  async _fetchPlace([lat, lng]) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error('geocode failed');
    const data = await res.json();
    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      data.address?.municipality ||
      data.address?.county;
    const country = data.address?.country;
    if (city && country) return `${city}, ${country}`;
    return data.display_name?.split(',').slice(0, 2).join(',') || '';
  }

  async _fetchWeather([lat, lng]) {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code`,
    );
    if (!res.ok) throw new Error('weather failed');
    const data = await res.json();
    return {
      temp: data.current?.temperature_2m,
      code: data.current?.weather_code,
      unit: data.current_units?.temperature_2m || '°C',
    };
  }

  _renderWorkoutMarker(workout) {
    const marker = new Marker(workout.coords)
      .addTo(this.#map)
      .bindPopup(
        new Popup({
          maxWidth: 260,
          minWidth: 120,
          autoClose: false,
          closeOnClick: false,
          className: `${workout.type}-popup`,
        }),
      )
      .setPopupContent(this._popupHtml(workout))
      .openPopup();

    this.#markers.set(workout.id, marker);

    if (workout.path?.length > 1) {
      const line = new Polyline(workout.path, {
        color: workout.type === 'running' ? '#3dffb5' : '#ff8c42',
        weight: 4,
        opacity: 0.9,
      }).addTo(this.#map);
      this.#paths.set(workout.id, line);
    }
  }

  _popupHtml(workout) {
    const icon = workout.type === 'running' ? '🏃' : '🚴';
    const place = workout.place ? `<br><small>${workout.place}</small>` : '';
    const weather =
      workout.weather?.temp != null
        ? `<br><small>${weatherLabel(workout.weather.code)} · ${workout.weather.temp}${workout.weather.unit}</small>`
        : '';
    return `${icon} ${workout.description}${place}${weather}`;
  }

  _refreshMarkerPopup(workout) {
    const marker = this.#markers.get(workout.id);
    if (!marker) return;
    marker.setPopupContent(this._popupHtml(workout));
  }

  _removeMapLayers(id) {
    const marker = this.#markers.get(id);
    const path = this.#paths.get(id);
    if (marker) {
      this.#map.removeLayer(marker);
      this.#markers.delete(id);
    }
    if (path) {
      this.#map.removeLayer(path);
      this.#paths.delete(id);
    }
  }

  _sortedWorkouts() {
    const list = [...this.#workouts];
    const [field, dir] = this.#sort.split('-');
    const factor = dir === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      if (field === 'date') return (new Date(a.date) - new Date(b.date)) * factor;
      return (a[field] - b[field]) * factor;
    });
  }

  _renderWorkoutList() {
    [...containerWorkouts.querySelectorAll('.workout, .empty')].forEach(el => el.remove());

    const workouts = this._sortedWorkouts();
    if (!workouts.length) {
      containerWorkouts.insertAdjacentHTML(
        'beforeend',
        `<li class="empty">Click the map to log your first workout.</li>`,
      );
      return;
    }

    workouts.forEach(workout => this._renderWorkout(workout));
  }

  _renderWorkout(workout) {
    const icon = workout.type === 'running' ? '🏃' : '🚴';
    let html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <div class="workout__head">
          <div>
            <h2 class="workout__title">${icon} ${workout.description}</h2>
            <span class="workout__meta">${workout.place || 'Resolving location…'}</span>
          </div>
          <div class="workout__actions">
            <button type="button" class="icon-btn" data-action="edit" title="Edit" aria-label="Edit workout">✎</button>
            <button type="button" class="icon-btn icon-btn--danger" data-action="delete" title="Delete" aria-label="Delete workout">✕</button>
          </div>
        </div>
        <div class="workout__details">
          <span class="workout__icon">${icon}</span>
          <span class="workout__value">${workout.distance}</span>
          <span class="workout__unit">km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⏱</span>
          <span class="workout__value">${workout.duration}</span>
          <span class="workout__unit">min</span>
        </div>
    `;

    if (workout.type === 'running') {
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡</span>
          <span class="workout__value">${workout.pace.toFixed(1)}</span>
          <span class="workout__unit">min/km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">👣</span>
          <span class="workout__value">${workout.cadence}</span>
          <span class="workout__unit">spm</span>
        </div>
      `;
    }

    if (workout.type === 'cycling') {
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡</span>
          <span class="workout__value">${workout.speed.toFixed(1)}</span>
          <span class="workout__unit">km/h</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⛰</span>
          <span class="workout__value">${workout.elevationGain}</span>
          <span class="workout__unit">m</span>
        </div>
      `;
    }

    if (workout.weather?.temp != null) {
      html += `<p class="workout__weather">${weatherLabel(workout.weather.code)} · ${workout.weather.temp}${workout.weather.unit}</p>`;
    }

    if (workout.path?.length > 1) {
      html += `<p class="workout__place">Route · ${workout.path.length} points</p>`;
    }

    html += `</li>`;
    containerWorkouts.insertAdjacentHTML('beforeend', html);
  }

  _onWorkoutListClick(e) {
    const actionBtn = e.target.closest('[data-action]');
    const workoutEl = e.target.closest('.workout');
    if (!workoutEl) return;

    const workout = this.#workouts.find(
      w => String(w.id) === String(workoutEl.dataset.id),
    );
    if (!workout) return;

    if (actionBtn?.dataset.action === 'delete') {
      e.preventDefault();
      e.stopPropagation();
      this._deleteWorkout(workout.id);
      return;
    }

    if (actionBtn?.dataset.action === 'edit') {
      e.preventDefault();
      e.stopPropagation();
      this._startEdit(workout);
      return;
    }

    this._moveToWorkout(workout);
  }

  _startEdit(workout) {
    this.#editingId = workout.id;
    inputType.value = workout.type;

    const cadenceRow = inputCadence.closest('.form__row');
    const elevRow = inputElevation.closest('.form__row');
    if (workout.type === 'running') {
      cadenceRow.classList.remove('form__row--hidden');
      elevRow.classList.add('form__row--hidden');
    } else {
      cadenceRow.classList.add('form__row--hidden');
      elevRow.classList.remove('form__row--hidden');
    }

    inputDistance.value = workout.distance;
    inputDuration.value = workout.duration;
    if (workout.type === 'running') inputCadence.value = workout.cadence;
    if (workout.type === 'cycling') inputElevation.value = workout.elevationGain;

    this._showForm();
    this._toast('Edit the fields and press Save.', 'ok', 'Editing');
  }

  async _deleteWorkout(id) {
    const ok = await this._confirm('Delete workout?', 'This removes the marker and saved data permanently.');
    if (!ok) return;

    this.#workouts = this.#workouts.filter(w => w.id !== id);
    this._removeMapLayers(id);
    this._renderWorkoutList();
    this._setLocalStorage();
    this._toast('Workout deleted.', 'ok', 'Removed');
  }

  async _deleteAllWorkouts() {
    if (!this.#workouts.length) {
      this._toast('There is nothing to clear yet.', 'warn', 'Empty list');
      return;
    }

    const ok = await this._confirm(
      'Delete all workouts?',
      `This will permanently remove ${this.#workouts.length} workout(s) from local storage.`,
    );
    if (!ok) return;

    this.#workouts.forEach(w => this._removeMapLayers(w.id));
    this.#workouts = [];
    this._renderWorkoutList();
    this._setLocalStorage();
    this._toast('All workouts cleared.', 'ok', 'Done');
  }

  _fitToWorkouts(showToast = true) {
    if (!this.#map || !this.#workouts.length) {
      if (showToast) this._toast('Add a workout first to fit the map.', 'warn', 'No workouts');
      return;
    }

    const points = this.#workouts.flatMap(w => (w.path?.length ? w.path : [w.coords]));
    const bounds = new LatLngBounds(points);
    this.#map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    if (showToast) this._toast('Map fitted to all workouts.', 'ok', 'Overview');
  }

  _setLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#workouts));
  }

  _getLocalStorage() {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!data?.length) return;

    this.#workouts = data.map(item => {
      const extras = {
        id: item.id,
        date: item.date,
        place: item.place || '',
        weather: item.weather || null,
        path: item.path || null,
        clicks: item.clicks || 0,
      };
      return item.type === 'running'
        ? new Running(item.coords, item.distance, item.duration, item.cadence, extras)
        : new Cycling(item.coords, item.distance, item.duration, item.elevationGain, extras);
    });
  }
}

new App();
