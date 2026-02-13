const categories = [
  {
    id: "picture",
    name: "Best Picture",
    nominees: 10,
    winnerBase: 0.16,
    films: [
      { title: "Avatar: Fire and Ash", studio: "Disney", precursor: 69, history: 62, buzz: 76, strength: "High" },
      { title: "Wicked: For Good", studio: "Universal", precursor: 72, history: 65, buzz: 82, strength: "High" },
      { title: "Mickey 17", studio: "Warner Bros.", precursor: 74, history: 71, buzz: 78, strength: "High" },
      { title: "Frankenstein", studio: "Netflix", precursor: 67, history: 58, buzz: 70, strength: "Medium" },
      { title: "The Running Man", studio: "Paramount", precursor: 54, history: 48, buzz: 61, strength: "Medium" },
      { title: "Superman", studio: "Warner Bros.", precursor: 57, history: 45, buzz: 79, strength: "Low" },
      { title: "F1", studio: "Apple/Warner", precursor: 63, history: 57, buzz: 73, strength: "Medium" },
      { title: "The Bride!", studio: "Warner Bros.", precursor: 59, history: 53, buzz: 68, strength: "Low" },
      { title: "Bugonia", studio: "Focus", precursor: 66, history: 60, buzz: 64, strength: "Medium" },
      { title: "Wake Up Dead Man", studio: "Netflix", precursor: 61, history: 51, buzz: 71, strength: "Low" }
    ]
  },
  {
    id: "director",
    name: "Best Director",
    nominees: 5,
    winnerBase: 0.24,
    films: [
      { title: "Mickey 17", studio: "Bong Joon-ho", precursor: 76, history: 79, buzz: 78, strength: "High" },
      { title: "Avatar: Fire and Ash", studio: "James Cameron", precursor: 65, history: 70, buzz: 77, strength: "Medium" },
      { title: "Frankenstein", studio: "Guillermo del Toro", precursor: 71, history: 73, buzz: 72, strength: "High" },
      { title: "Bugonia", studio: "Yorgos Lanthimos", precursor: 68, history: 67, buzz: 66, strength: "Medium" },
      { title: "The Bride!", studio: "Maggie Gyllenhaal", precursor: 56, history: 52, buzz: 60, strength: "Low" },
      { title: "Wicked: For Good", studio: "Jon M. Chu", precursor: 58, history: 49, buzz: 70, strength: "Low" }
    ]
  },
  {
    id: "actor",
    name: "Best Actor",
    nominees: 5,
    winnerBase: 0.25,
    films: [
      { title: "Mickey 17 (Robert Pattinson)", studio: "WB", precursor: 73, history: 68, buzz: 75, strength: "High" },
      { title: "The Smashing Machine (Dwayne Johnson)", studio: "A24", precursor: 70, history: 63, buzz: 71, strength: "High" },
      { title: "F1 (Brad Pitt)", studio: "Apple/Warner", precursor: 66, history: 65, buzz: 73, strength: "Medium" },
      { title: "The Running Man (Glen Powell)", studio: "Paramount", precursor: 57, history: 54, buzz: 64, strength: "Low" },
      { title: "Frankenstein (Oscar Isaac)", studio: "Netflix", precursor: 62, history: 59, buzz: 67, strength: "Medium" },
      { title: "Wake Up Dead Man (Daniel Craig)", studio: "Netflix", precursor: 64, history: 56, buzz: 70, strength: "Medium" }
    ]
  },
  {
    id: "actress",
    name: "Best Actress",
    nominees: 5,
    winnerBase: 0.24,
    films: [
      { title: "Wicked: For Good (Cynthia Erivo)", studio: "Universal", precursor: 77, history: 72, buzz: 82, strength: "High" },
      { title: "The Bride! (Jessie Buckley)", studio: "WB", precursor: 68, history: 66, buzz: 69, strength: "Medium" },
      { title: "Bugonia (Emma Stone)", studio: "Focus", precursor: 75, history: 74, buzz: 70, strength: "High" },
      { title: "Frankenstein (Mia Goth)", studio: "Netflix", precursor: 61, history: 58, buzz: 65, strength: "Low" },
      { title: "Avatar: Fire and Ash (Zoe Saldana)", studio: "Disney", precursor: 58, history: 53, buzz: 72, strength: "Low" },
      { title: "Anora follow-up contender", studio: "Neon", precursor: 55, history: 60, buzz: 63, strength: "Low" }
    ]
  }
];

const state = {
  categoryId: categories[0].id,
  weights: {
    precursor: 58,
    history: 30,
    buzz: 12
  }
};

const categoryTabs = document.querySelector("#categoryTabs");
const categoryTitle = document.querySelector("#categoryTitle");
const candidateCards = document.querySelector("#candidateCards");
const resultsBody = document.querySelector("#resultsBody");
const precursorWeight = document.querySelector("#precursorWeight");
const historyWeight = document.querySelector("#historyWeight");
const buzzWeight = document.querySelector("#buzzWeight");
const precursorWeightValue = document.querySelector("#precursorWeightValue");
const historyWeightValue = document.querySelector("#historyWeightValue");
const buzzWeightValue = document.querySelector("#buzzWeightValue");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWeights() {
  const total = state.weights.precursor + state.weights.history + state.weights.buzz;
  return {
    precursor: state.weights.precursor / total,
    history: state.weights.history / total,
    buzz: state.weights.buzz / total
  };
}

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

function strengthBoost(strength) {
  if (strength === "High") return 1.06;
  if (strength === "Medium") return 1.0;
  return 0.94;
}

function getActiveCategory() {
  return categories.find((category) => category.id === state.categoryId);
}

function scoreFilm(film, normalizedWeights) {
  const linear =
    film.precursor * normalizedWeights.precursor +
    film.history * normalizedWeights.history +
    film.buzz * normalizedWeights.buzz;

  const centered = (linear - 55) / 12;
  const nominationRaw = logistic(centered) * strengthBoost(film.strength);
  const winnerRaw = nominationRaw * (0.6 + film.precursor / 190);

  return {
    nominationRaw,
    winnerRaw
  };
}

function renderTabs() {
  categoryTabs.innerHTML = "";

  categories.forEach((category) => {
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(category.id === state.categoryId));
    tab.textContent = category.name;
    tab.addEventListener("click", () => {
      state.categoryId = category.id;
      render();
    });
    categoryTabs.appendChild(tab);
  });
}

function createCard(category, film, filmIndex) {
  const card = document.createElement("div");
  card.className = "candidate-card";

  const head = document.createElement("div");
  head.className = "candidate-head";

  const title = document.createElement("h3");
  title.textContent = film.title;

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = `${film.studio}`;

  head.append(title, badge);

  const grid = document.createElement("div");
  grid.className = "mini-grid";

  const fields = [
    { key: "precursor", label: "Precursor" },
    { key: "history", label: "Historical" },
    { key: "buzz", label: "Buzz" }
  ];

  fields.forEach((field) => {
    const wrapper = document.createElement("label");
    wrapper.textContent = field.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(film[field.key]);
    input.addEventListener("input", (event) => {
      film[field.key] = clamp(Number(event.target.value || 0), 0, 100);
      renderResults(category);
    });
    wrapper.appendChild(input);
    grid.appendChild(wrapper);
  });

  const strengthLabel = document.createElement("label");
  strengthLabel.textContent = "Campaign Strength";
  const strengthSelect = document.createElement("select");
  ["Low", "Medium", "High"].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === film.strength;
    strengthSelect.appendChild(option);
  });
  strengthSelect.addEventListener("change", (event) => {
    categories
      .find((c) => c.id === category.id)
      .films[filmIndex].strength = event.target.value;
    renderResults(category);
  });
  strengthLabel.appendChild(strengthSelect);
  grid.appendChild(strengthLabel);

  card.append(head, grid);
  return card;
}

function renderCandidates(category) {
  categoryTitle.textContent = category.name;
  candidateCards.innerHTML = "";

  category.films.forEach((film, index) => {
    candidateCards.appendChild(createCard(category, film, index));
  });
}

function renderResults(category) {
  const normalized = normalizeWeights();

  const scored = category.films.map((film) => {
    const scores = scoreFilm(film, normalized);
    return { ...film, ...scores };
  });

  const nominationTotal = scored.reduce((sum, item) => sum + item.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, item) => sum + item.winnerRaw, 0) || 1;

  const nomineeScale = category.nominees / Math.max(1, scored.length);

  const projections = scored
    .map((film) => {
      const nomination = clamp((film.nominationRaw / nominationTotal) * 100 * nomineeScale, 0.4, 99);
      const winner = clamp(
        ((film.winnerRaw / winnerTotal) * 100 + nomination * category.winnerBase) /
          (1 + category.winnerBase),
        0.2,
        90
      );

      return {
        title: film.title,
        nomination,
        winner
      };
    })
    .sort((a, b) => b.winner - a.winner);

  resultsBody.innerHTML = "";
  projections.forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong>${entry.title}</strong></td><td>${entry.nomination.toFixed(1)}%</td><td>${entry.winner.toFixed(1)}%</td>`;
    resultsBody.appendChild(row);
  });
}

function syncWeightLabels() {
  precursorWeightValue.textContent = `${state.weights.precursor}%`;
  historyWeightValue.textContent = `${state.weights.history}%`;
  buzzWeightValue.textContent = `${state.weights.buzz}%`;
}

function bindWeightInputs() {
  const map = [
    { input: precursorWeight, key: "precursor" },
    { input: historyWeight, key: "history" },
    { input: buzzWeight, key: "buzz" }
  ];

  map.forEach(({ input, key }) => {
    input.addEventListener("input", (event) => {
      state.weights[key] = clamp(Number(event.target.value || 0), 1, 95);
      syncWeightLabels();
      renderResults(getActiveCategory());
    });
  });
}

function render() {
  const activeCategory = getActiveCategory();
  renderTabs();
  renderCandidates(activeCategory);
  renderResults(activeCategory);
}

bindWeightInputs();
syncWeightLabels();
render();
