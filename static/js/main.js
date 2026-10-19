const state = {
  compareIds: new Set(),
  selectedListings: []
};

const listingGrid = document.getElementById('listingGrid');
const compareTray = document.getElementById('compareTray');
const compareResults = document.getElementById('compareResults');
const recommendationResults = document.getElementById('recommendationResults');
const filterForm = document.getElementById('filterForm');
const recommendForm = document.getElementById('recommendForm');
const showRecommendation = document.getElementById('show-recommendation');
const navToggle = document.querySelector('.nav-toggle');
const mainNav = document.querySelector('.main-nav');
const themeToggle = document.querySelector('.theme-toggle');

const template = document.getElementById('listingCardTemplate');

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  if (themeToggle) {
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  localStorage.setItem('staymatch-theme', theme);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function getFiltersFromForm(form) {
  const data = new FormData(form);
  const payload = {};

  for (const [key, value] of data.entries()) {
    if (value !== '') {
      payload[key] = value;
    }
  }

  return payload;
}

function buildQueryString(params) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      query.append(key, value);
    }
  });

  return query.toString();
}

async function fetchListings(filters = {}) {
  const query = buildQueryString(filters);
  const response = await fetch(`/api/listings${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error('Could not load listings.');
  }

  return response.json();
}

function normalizeFacilities(facilities) {
  if (Array.isArray(facilities)) return facilities.map((item) => String(item).trim()).filter(Boolean);
  if (typeof facilities === 'string') {
    return facilities
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function renderFacilityTags(facilities) {
  const tags = normalizeFacilities(facilities);

  return tags
    .slice(0, 4)
    .map((facility) => `<li>${facility}</li>`)
    .join('');
}

function populateCompareTray() {
  const selected = [...state.compareIds];

  if (!selected.length) {
    compareTray.innerHTML = '<p class="empty-state">Select listings from the grid to compare them.</p>';
    return;
  }

  compareTray.innerHTML = selected
    .map((id) => {
      const listing = state.selectedListings.find((item) => String(item.id) === String(id));
      if (!listing) return '';

      return `
        <div class="compare-item">
          <span>${listing.title}</span>
          <button type="button" data-remove-id="${id}" aria-label="Remove ${listing.title}">×</button>
        </div>
      `;
    })
    .join('');

  compareTray.querySelectorAll('[data-remove-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.compareIds.delete(button.dataset.removeId);
      populateCompareTray();
      renderComparison();
    });
  });
}

async function renderComparison() {
  const ids = [...state.compareIds];

  if (ids.length < 2) {
    compareResults.innerHTML = '<div class="empty-results">Pick at least two listings to compare.</div>';
    return;
  }

  const params = new URLSearchParams();
  ids.forEach((id) => params.append('ids', id));

  const response = await fetch(`/api/compare?${params.toString()}`);
  if (!response.ok) {
    compareResults.innerHTML = '<div class="empty-results">The comparison data could not be loaded.</div>';
    return;
  }

  const payload = await response.json();
  const listingSet = payload.listings || [];
  const facilities = payload.facilities || [];

  compareResults.innerHTML = listingSet
    .map((listing) => {
      const itemFacilities = normalizeFacilities(listing.facilities || []);
      const rows = facilities.map((facility) => {
        const included = itemFacilities.includes(facility);
        return `<li>${included ? '✅' : '—'} ${facility}</li>`;
      }).join('');

      return `
        <article class="compare-card is-visible">
          <h3>${listing.title}</h3>
          <p><strong>${formatCurrency(listing.price)}</strong></p>
          <p>${listing.address}</p>
          <p>${listing.distance_km} km away</p>
          <ul>${rows}</ul>
        </article>
      `;
    })
    .join('');
}

function renderList(listings) {
  listingGrid.innerHTML = '';

  if (!listings.length) {
    listingGrid.innerHTML = '<div class="empty-results">No listings match your filters yet. Try widening your search.</div>';
    return;
  }

  state.selectedListings = listings;

  listings.forEach((listing) => {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector('.listing-card');
    const compareButton = fragment.querySelector('.watch-btn');
    const compareCheck = fragment.querySelector('.compare-check');

    article.classList.add('is-visible');
    article.dataset.id = listing.id;
    fragment.querySelector('.listing-title').textContent = listing.title;
    fragment.querySelector('.listing-address').textContent = listing.address;
    fragment.querySelector('.price').textContent = formatCurrency(listing.price);
    fragment.querySelector('.distance').textContent = `${listing.distance_km} km away`;
    fragment.querySelector('.facility-list').innerHTML = renderFacilityTags(listing.facilities || []);

    if (!normalizeFacilities(listing.facilities || []).length) {
      fragment.querySelector('.facility-list').innerHTML = '<li>Essential amenities</li>';
    }

    const isSelected = state.compareIds.has(String(listing.id));
    compareCheck.classList.toggle('is-selected', isSelected);
    compareCheck.textContent = isSelected ? 'Selected' : 'Select';

    compareCheck.addEventListener('click', () => {
      const key = String(listing.id);

      if (state.compareIds.has(key)) {
        state.compareIds.delete(key);
      } else if (state.compareIds.size < 3) {
        state.compareIds.add(key);
      } else {
        alert('You can compare up to three listings at once.');
        return;
      }

      populateCompareTray();
      renderComparison();
      renderList(listings);
    });

    compareButton.addEventListener('click', () => {
      const key = String(listing.id);

      if (!state.compareIds.has(key)) {
        if (state.compareIds.size >= 3) {
          alert('You can compare up to three listings at once.');
          return;
        }
        state.compareIds.add(key);
      }

      populateCompareTray();
      renderComparison();
      renderList(listings);
    });

    listingGrid.appendChild(fragment);
  });

  populateCompareTray();
  renderComparison();
}

async function loadListings() {
  const filters = getFiltersFromForm(filterForm);
  try {
    const listings = await fetchListings(filters);
    renderList(listings);
  } catch (error) {
    listingGrid.innerHTML = `<div class="empty-results">${error.message}</div>`;
  }
}

async function loadRecommendations(payload) {
  const response = await fetch('/api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Could not generate recommendations.');
  }

  return response.json();
}

function renderRecommendations(items) {
  if (!items.length) {
    recommendationResults.innerHTML = '<div class="empty-results">No recommended homes fit your criteria. Try relaxing a few filters.</div>';
    return;
  }

  recommendationResults.innerHTML = items
  .map((item, index) => {
    const facilities = normalizeFacilities(item.facilities || []);
    return `
      <article class="rec-card is-visible">
        <div class="rec-rank">#${index + 1}</div>
        <div class="rec-main">
          <h3>${item.title}</h3>
          <p>${item.address} · ${item.distance_km} km away</p>
          <p>${formatCurrency(item.price)} · ${facilities.slice(0, 3).join(' • ') || 'Essential amenities'}</p>
        </div>
        <div class="rec-score">${Number(item.score || 0).toFixed(2)} score</div>
      </article>
    `;
  })
  .join('');
}

filterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadListings();
});

recommendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = getFiltersFromForm(recommendForm);

  try {
    const recommendations = await loadRecommendations({
      budget: values.budget || null,
      max_distance: values.max_distance || null,
      required: values.required || '',
      preferred: values.preferred || '',
      w_price: values.w_price || 0,
      w_distance: values.w_distance || 0,
      w_facilities: values.w_facilities || 0
    });

    renderRecommendations(recommendations);
  } catch (error) {
    recommendationResults.innerHTML = `<div class="empty-results">${error.message}</div>`;
  }
});

showRecommendation.addEventListener('click', () => {
  document.getElementById('recommend').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

if (themeToggle) {
  const savedTheme = localStorage.getItem('staymatch-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme || (preferredDark ? 'dark' : 'light'));

  themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });
}

if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  mainNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mainNav.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const revealTargets = document.querySelectorAll('.reveal-up, .stat-card, .feature-pill, .listing-card, .compare-card, .rec-card');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.14 });

revealTargets.forEach((target) => revealObserver.observe(target));

loadListings();
renderRecommendations([]);
