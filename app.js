import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  updateProfile,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjjLXaJCtf-daGURaKrDQoVDxA-wvZ5ZY",
  authDomain: "apexfinance-e6e0a.firebaseapp.com",
  projectId: "apexfinance-e6e0a",
  storageBucket: "apexfinance-e6e0a.firebasestorage.app",
  messagingSenderId: "775710735297",
  appId: "1:775710735297:web:6061d22ba9c9822f394d40",
  measurementId: "G-1LMKT99E7N"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestoreDb = getFirestore(firebaseApp);

// ==========================================================================
// FIREBASE API SERVICE
// ==========================================================================
const APIService = {
  currentUser: null,

  // Local Storage Helpers for Transactions
  getLocalTransactions() {
    const userId = this.currentUser ? this.currentUser.id : 'anonymous';
    const txs = localStorage.getItem(`apex_local_transactions_${userId}`);
    return txs ? JSON.parse(txs) : [];
  },

  saveLocalTransactions(txs) {
    const userId = this.currentUser ? this.currentUser.id : 'anonymous';
    localStorage.setItem(`apex_local_transactions_${userId}`, JSON.stringify(txs));
  },

  // Local Storage Helpers for Categories
  getLocalCategories() {
    const userId = this.currentUser ? this.currentUser.id : 'anonymous';
    const cats = localStorage.getItem(`apex_local_categories_${userId}`);
    return cats ? JSON.parse(cats) : [];
  },

  saveLocalCategories(cats) {
    const userId = this.currentUser ? this.currentUser.id : 'anonymous';
    localStorage.setItem(`apex_local_categories_${userId}`, JSON.stringify(cats));
  },

  // Local Storage Helpers for Users (Auth fallback)
  getLocalUsers() {
    const users = localStorage.getItem('apex_local_users');
    return users ? JSON.parse(users) : {};
  },

  saveLocalUsers(users) {
    localStorage.setItem('apex_local_users', JSON.stringify(users));
  },

  async registerLocal(username, password, fullName) {
    const users = this.getLocalUsers();
    if (users[username.toLowerCase()]) {
      throw new Error("Username already exists locally.");
    }
    const id = 'local_' + Math.random().toString(36).substr(2, 9);
    users[username.toLowerCase()] = { id, username, password, fullName };
    this.saveLocalUsers(users);
    return { id, username, fullName };
  },

  async loginLocal(username, password) {
    const users = this.getLocalUsers();
    const user = users[username.toLowerCase()];
    if (!user || user.password !== password) {
      throw new Error("Incorrect username or password.");
    }
    this.currentUser = { id: user.id, username: user.username, fullName: user.fullName };
    localStorage.setItem('apex_current_user', JSON.stringify(this.currentUser));
    localStorage.setItem('apex_login_timestamp', Date.now().toString());
    return this.currentUser;
  },

  async init() {
    return new Promise((resolve) => {
      try {
        onAuthStateChanged(auth, async (user) => {
          if (user) {
            // Check 24 hour session expiration
            const loginTimestamp = localStorage.getItem('apex_login_timestamp');
            const elapsed = loginTimestamp ? (Date.now() - parseInt(loginTimestamp, 10)) : 0;
            const twentyFourHours = 24 * 60 * 60 * 1000;
            
            if (loginTimestamp && elapsed >= twentyFourHours) {
              await signOut(auth);
              this.currentUser = null;
              localStorage.removeItem('apex_current_user');
              localStorage.removeItem('apex_login_timestamp');
              showToast('Session expired. Please sign in again.', 'warning');
            } else {
              let storedUsername = user.email.split('@')[0];
              let storedFullName = user.displayName || user.email.split('@')[0];
              try {
                const userDoc = await getDoc(doc(firestoreDb, "users", user.uid));
                if (userDoc.exists()) {
                  const data = userDoc.data();
                  storedUsername = data.username || storedUsername;
                  storedFullName = data.fullName || storedFullName;
                }
              } catch (fsErr) {
                console.warn("Could not fetch user document from Firestore:", fsErr);
              }

              this.currentUser = {
                id: user.uid,
                username: storedUsername,
                fullName: storedFullName
              };
              localStorage.setItem('apex_current_user', JSON.stringify(this.currentUser));
              if (!loginTimestamp) {
                localStorage.setItem('apex_login_timestamp', Date.now().toString());
              }
            }
          } else {
            this.currentUser = null;
            localStorage.removeItem('apex_current_user');
          }
          updateConnectionStatusUI();
          resolve();
        });
      } catch (err) {
        console.error("Firebase Auth initialization failed:", err);
        this.currentUser = null;
        localStorage.removeItem('apex_current_user');
        updateConnectionStatusUI();
        resolve();
      }
    });
  },

  async register(username, password, fullName) {
    const email = username.includes('@') ? username : `${username}@apexfinance.com`;
    const cleanUsername = username.includes('@') ? username.split('@')[0] : username;
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Update profile details
    await updateProfile(user, { displayName: fullName });
    
    // Store user document inside Firestore
    await setDoc(doc(firestoreDb, "users", user.uid), {
      fullName: fullName,
      username: cleanUsername,
      email: email,
      createdAt: new Date().toISOString()
    });

    return { id: user.uid, username: cleanUsername, fullName };
  },

  async login(username, password) {
    const email = username.includes('@') ? username : `${username}@apexfinance.com`;
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Fetch user details from Firestore
    const userDoc = await getDoc(doc(firestoreDb, "users", user.uid));
    const storedFullName = userDoc.exists() ? userDoc.data().fullName : (user.displayName || username.split('@')[0]);
    const storedUsername = userDoc.exists() ? userDoc.data().username : username.split('@')[0];

    this.currentUser = { id: user.uid, username: storedUsername, fullName: storedFullName };
    localStorage.setItem('apex_current_user', JSON.stringify(this.currentUser));
    localStorage.setItem('apex_login_timestamp', Date.now().toString());

    return this.currentUser;
  },

  async loginWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      const email = user.email;
      const fullName = user.displayName || email.split('@')[0];
      const username = email.split('@')[0];

      // Save user details to Firestore if not already saved
      const userDocRef = doc(firestoreDb, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          fullName: fullName,
          username: username,
          email: email,
          createdAt: new Date().toISOString()
        });
      } else {
        const data = userDoc.data();
        this.currentUser = {
          id: user.uid,
          username: data.username || username,
          fullName: data.fullName || fullName
        };
      }

      if (!this.currentUser) {
        this.currentUser = { id: user.uid, username, fullName };
      }

      localStorage.setItem('apex_current_user', JSON.stringify(this.currentUser));
      localStorage.setItem('apex_login_timestamp', Date.now().toString());

      updateConnectionStatusUI();

      return this.currentUser;
    } catch (err) {
      console.error("Google authentication failed:", err);
      throw err;
    }
  },

  async resetPassword(username, newPassword) {
    // Client-side Firebase Auth resets password by sending a reset email.
    // Throw error for demo virtual accounts since they cannot receive it.
    if (!username.includes('@')) {
      throw new Error("Password reset is only supported for real email addresses. Demo accounts cannot be reset client-side.");
    }
    await sendPasswordResetEmail(auth, username);
    return { username };
  },

  async logout() {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Firebase signOut failed:", e);
    }
    this.currentUser = null;
    localStorage.removeItem('apex_current_user');
    localStorage.removeItem('apex_login_timestamp');
  },

  async getTransactions() {
    if (!this.currentUser) return [];
    const q = query(
      collection(firestoreDb, "transactions"), 
      where("userId", "==", this.currentUser.id)
    );
    const querySnapshot = await getDocs(q);
    const txs = [];
    querySnapshot.forEach((doc) => {
      txs.push({ id: doc.id, ...doc.data() });
    });
    return txs;
  },

  async createTransaction(tx) {
    if (!this.currentUser) throw new Error("User must be logged in.");
    const newTx = {
      userId: this.currentUser.id,
      amount: parseFloat(tx.amount),
      type: tx.type,
      category: tx.category,
      date: tx.date,
      description: tx.description || ''
    };
    const docRef = await addDoc(collection(firestoreDb, "transactions"), newTx);
    return { id: docRef.id, ...newTx };
  },

  async updateTransaction(id, tx) {
    if (!this.currentUser) throw new Error("User must be logged in.");
    const txRef = doc(firestoreDb, "transactions", id);
    const updatedData = {
      amount: parseFloat(tx.amount),
      type: tx.type,
      category: tx.category,
      date: tx.date,
      description: tx.description || ''
    };
    await updateDoc(txRef, updatedData);
    return { id, ...updatedData, userId: this.currentUser.id };
  },

  async deleteTransaction(id) {
    if (!this.currentUser) throw new Error("User must be logged in.");
    const txRef = doc(firestoreDb, "transactions", id);
    await deleteDoc(txRef);
    return { id };
  },

  async getCategories() {
    const defaultCats = [
      { name: "Salary", type: "income", color: "#10b981", icon: "fa-briefcase" },
      { name: "Freelance", type: "income", color: "#06b6d4", icon: "fa-laptop-code" },
      { name: "Investments", type: "income", color: "#8b5cf6", icon: "fa-chart-line" },
      { name: "Other Income", type: "income", color: "#14b8a6", icon: "fa-coins" },
      { name: "Food", type: "expense", color: "#f59e0b", icon: "fa-utensils" },
      { name: "Rent", type: "expense", color: "#ef4444", icon: "fa-house" },
      { name: "Utilities", type: "expense", color: "#3b82f6", icon: "fa-bolt" },
      { name: "Entertainment", type: "expense", color: "#ec4899", icon: "fa-film" },
      { name: "Shopping", type: "expense", color: "#d946ef", icon: "fa-bag-shopping" },
      { name: "Transport", type: "expense", color: "#0ea5e9", icon: "fa-car" },
      { name: "Healthcare", type: "expense", color: "#e11d48", icon: "fa-heart-pulse" },
      { name: "Education", type: "expense", color: "#f97316", icon: "fa-graduation-cap" },
      { name: "Travel", type: "expense", color: "#84cc16", icon: "fa-plane" },
      { name: "Miscellaneous", type: "expense", color: "#64748b", icon: "fa-circle-question" }
    ];

    if (!this.currentUser) return defaultCats;
    const q = query(
      collection(firestoreDb, "categories"), 
      where("userId", "==", this.currentUser.id)
    );
    const querySnapshot = await getDocs(q);
    const customCats = [];
    querySnapshot.forEach((doc) => {
      customCats.push(doc.data());
    });
    return [...defaultCats, ...customCats];
  },

  async createCategory(cat) {
    if (!this.currentUser) throw new Error("User must be logged in.");
    const newCat = {
      name: cat.name,
      type: cat.type,
      color: cat.color,
      icon: cat.icon,
      userId: this.currentUser.id
    };
    
    const defaultCats = ["salary", "freelance", "investments", "other income", "food", "rent", "utilities", "entertainment", "shopping", "transport", "healthcare", "education", "travel", "miscellaneous"];
    if (defaultCats.includes(cat.name.toLowerCase())) {
      throw new Error('Category already exists');
    }

    const q = query(
      collection(firestoreDb, "categories"), 
      where("userId", "==", this.currentUser.id),
      where("name", "==", cat.name)
    );
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      throw new Error('Category already exists');
    }

    await addDoc(collection(firestoreDb, "categories"), newCat);
    return newCat;
  }
};



// ==========================================================================
// CONNECTION STATUS UI
// ==========================================================================
function updateConnectionStatusUI() {
  const statusContainer = document.getElementById('connection-status-container');
  if (!statusContainer) return;

  const user = APIService.currentUser;

  if (!user) {
    statusContainer.innerHTML = '';
    return;
  }

  statusContainer.innerHTML = `
    <div class="status-badge online" title="Connected to Firebase Cloud" id="connection-status-badge">
      <i class="fa-solid fa-cloud"></i>
      <span>Connected</span>
    </div>
  `;
}

// ==========================================================================
// APPLICATION STATE
// ==========================================================================
const AppState = {
  transactions: [],
  categories: [],
  filteredTransactions: [],
  isOfflineMode: false,
  
  // Ledger page controls
  currentPage: 1,
  pageSize: 8,
  
  // Active filters
  filters: {
    period: 'all', // 'all' or 'YYYY-MM'
    type: 'all',   // 'all', 'income', 'expense'
    category: 'all',
    search: ''
  },
  
  // Active sorts
  sort: 'date-desc', // 'date-desc', 'date-asc', 'amount-desc', 'amount-asc'

  async reloadData() {
    try {
      this.transactions = await APIService.getTransactions();
      this.categories = await APIService.getCategories();
      this.applyFiltersAndSort();
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  applyFiltersAndSort() {
    // 1. Filter
    this.filteredTransactions = this.transactions.filter(t => {
      // Period filter
      if (this.filters.period !== 'all') {
        const tPeriod = t.date.substring(0, 7); // "YYYY-MM"
        if (tPeriod !== this.filters.period) return false;
      }
      // Type filter
      if (this.filters.type !== 'all' && t.type !== this.filters.type) {
        return false;
      }
      // Category filter
      if (this.filters.category !== 'all' && t.category !== this.filters.category) {
        return false;
      }
      // Search filter
      if (this.filters.search) {
        const query = this.filters.search.toLowerCase();
        const descMatch = t.description && t.description.toLowerCase().includes(query);
        const catMatch = t.category && t.category.toLowerCase().includes(query);
        if (!descMatch && !catMatch) return false;
      }
      return true;
    });

    // 2. Sort
    this.filteredTransactions.sort((a, b) => {
      switch (this.sort) {
        case 'date-asc':
          return new Date(a.date) - new Date(b.date);
        case 'amount-desc':
          return b.amount - a.amount;
        case 'amount-asc':
          return a.amount - b.amount;
        case 'date-desc':
        default:
          return new Date(b.date) - new Date(a.date);
      }
    });

    // Reset page if it exceeds limits after filtering
    const maxPages = Math.ceil(this.filteredTransactions.length / this.pageSize) || 1;
    if (this.currentPage > maxPages) {
      this.currentPage = maxPages;
    }
  }
};

// ==========================================================================
// THEME MANAGEMENT (DARK / LIGHT MODE)
// ==========================================================================
const ThemeManager = {
  theme: 'dark', // default

  init() {
    const savedTheme = localStorage.getItem('apex_theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme) {
      this.setTheme(savedTheme);
    } else if (systemPrefersDark) {
      this.setTheme('dark');
    } else {
      this.setTheme('dark');
    }

    // Attach click listeners to all theme toggle buttons
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleTheme();
      });
    });
  },

  setTheme(theme) {
    this.theme = theme;
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('apex_theme', theme);
    this.updateToggleIcons();
    
    // Refresh charts if they are rendered and visible
    if (cashflowChart || categoryChart) {
      updateCharts();
    }
  },

  toggleTheme() {
    const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
    showToast(`Theme switched to ${nextTheme} mode`, 'success');
  },

  updateToggleIcons() {
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      const icon = btn.querySelector('i');
      if (icon) {
        if (this.theme === 'dark') {
          icon.className = 'fa-solid fa-sun';
          btn.setAttribute('title', 'Switch to Light Mode');
        } else {
          icon.className = 'fa-solid fa-moon';
          btn.setAttribute('title', 'Switch to Dark Mode');
        }
      }
    });
  }
};

// ==========================================================================
// CHARTS MANAGEMENT
// ==========================================================================
let cashflowChart = null;
let categoryChart = null;

function updateCharts() {
  const trendsCtx = document.getElementById('cashflowTrendChart').getContext('2d');
  const categoryCtx = document.getElementById('categoryBreakdownChart').getContext('2d');

  // Read theme colors from CSS properties dynamically
  const style = getComputedStyle(document.documentElement);
  const chartText = style.getPropertyValue('--chart-text-color').trim() || '#94a3b8';
  const chartGrid = style.getPropertyValue('--chart-grid-color').trim() || 'rgba(255, 255, 255, 0.04)';
  const chartBorder = style.getPropertyValue('--chart-border-color').trim() || '#131a2c';

  // Filter transactions matching CURRENT period only for accurate dashboard displays
  const periodTxs = AppState.transactions.filter(t => {
    if (AppState.filters.period === 'all') return true;
    return t.date.substring(0, 7) === AppState.filters.period;
  });

  const incomes = periodTxs.filter(t => t.type === 'income');
  const expenses = periodTxs.filter(t => t.type === 'expense');

  // --- CHART 1: CASH FLOW HISTORY ---
  const trendDataMap = {};

  if (AppState.filters.period === 'all') {
    // Group by Month (last 12 months with activity)
    periodTxs.forEach(t => {
      const monthKey = t.date.substring(0, 7); // YYYY-MM
      if (!trendDataMap[monthKey]) {
        trendDataMap[monthKey] = { income: 0, expense: 0 };
      }
      trendDataMap[monthKey][t.type] += t.amount;
    });
  } else {
    // Group by Day for the selected month
    const daysInMonth = new Date(
      parseInt(AppState.filters.period.substring(0, 4)),
      parseInt(AppState.filters.period.substring(5, 7)),
      0
    ).getDate();

    // Initialize map for all days of the month to keep the timeline chronological
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${AppState.filters.period}-${d.toString().padStart(2, '0')}`;
      trendDataMap[dayStr] = { income: 0, expense: 0 };
    }

    periodTxs.forEach(t => {
      if (trendDataMap[t.date]) {
        trendDataMap[t.date][t.type] += t.amount;
      }
    });
  }

  const sortedKeys = Object.keys(trendDataMap).sort();
  const labels = sortedKeys.map(k => {
    if (k.length === 7) {
      const parts = k.split('-');
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      return dateObj.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    } else {
      return k.substring(8); // just show day "DD"
    }
  });

  const incomeDataset = sortedKeys.map(k => trendDataMap[k].income);
  const expenseDataset = sortedKeys.map(k => trendDataMap[k].expense);

  // Toggle canvas placeholder
  const trendPlaceholder = document.getElementById('cashflow-no-data');
  const trendCanvas = document.getElementById('cashflowTrendChart');
  if (sortedKeys.length === 0 || (incomes.length === 0 && expenses.length === 0)) {
    trendPlaceholder.style.display = 'flex';
    trendCanvas.style.display = 'none';
  } else {
    trendPlaceholder.style.display = 'none';
    trendCanvas.style.display = 'block';

    if (cashflowChart) cashflowChart.destroy();
    
    cashflowChart = new Chart(trendsCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Inflow (Income)',
            data: incomeDataset,
            backgroundColor: '#10b981',
            borderRadius: 4
          },
          {
            label: 'Outflow (Expense)',
            data: expenseDataset,
            backgroundColor: '#f43f5e',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: chartText, font: { family: 'Inter', size: 11 } },
            position: 'top'
          }
        },
        scales: {
          x: { grid: { color: chartGrid }, ticks: { color: chartText } },
          y: { grid: { color: chartGrid }, ticks: { color: chartText } }
        }
      }
    });
  }

  // --- CHART 2: CATEGORY BREAKDOWN ---
  const catSumMap = {};
  expenses.forEach(t => {
    catSumMap[t.category] = (catSumMap[t.category] || 0) + t.amount;
  });

  const catLabels = Object.keys(catSumMap);
  const catData = Object.values(catSumMap);

  // Find colors linked to category names
  const catColors = catLabels.map(label => {
    const cObj = AppState.categories.find(c => c.name === label);
    return cObj ? cObj.color : '#64748b';
  });

  const catPlaceholder = document.getElementById('category-no-data');
  const catCanvas = document.getElementById('categoryBreakdownChart');

  if (catLabels.length === 0) {
    catPlaceholder.style.display = 'flex';
    catCanvas.style.display = 'none';
  } else {
    catPlaceholder.style.display = 'none';
    catCanvas.style.display = 'block';

    if (categoryChart) categoryChart.destroy();

    categoryChart = new Chart(categoryCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: catColors,
          borderWidth: 2,
          borderColor: chartBorder
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: chartText, font: { family: 'Inter', size: 11 } }
          }
        }
      }
    });
  }
}

// ==========================================================================
// RENDER INTERFACE COMPONENTS
// ==========================================================================

function updateKPIs() {
  // Filters matching CURRENT selected period
  const periodTxs = AppState.transactions.filter(t => {
    if (AppState.filters.period === 'all') return true;
    return t.date.substring(0, 7) === AppState.filters.period;
  });

  let totalIncome = 0;
  let totalExpense = 0;

  periodTxs.forEach(t => {
    if (t.type === 'income') totalIncome += t.amount;
    if (t.type === 'expense') totalExpense += t.amount;
  });

  const netBalance = totalIncome - totalExpense;

  // Format currencies
  document.getElementById('kpi-total-balance').textContent = formatCurrency(netBalance);
  document.getElementById('kpi-total-income').textContent = formatCurrency(totalIncome);
  document.getElementById('kpi-total-expense').textContent = formatCurrency(totalExpense);

  // Visual cues on balance card (negative vs positive styling)
  const balanceCard = document.getElementById('kpi-total-balance');
  if (netBalance < 0) {
    balanceCard.className = 'kpi-value text-expense';
  } else if (netBalance > 0) {
    balanceCard.className = 'kpi-value text-income';
  } else {
    balanceCard.className = 'kpi-value';
  }

  // Calculate Savings Rate percentage
  let savingsRate = 0;
  if (totalIncome > 0) {
    savingsRate = Math.max(0, Math.min(100, Math.round(((totalIncome - totalExpense) / totalIncome) * 100)));
  }

  document.getElementById('kpi-savings-rate').textContent = `${savingsRate}%`;
  document.getElementById('savings-progress-fill').style.width = `${savingsRate}%`;

  // Dynamic KPI footers
  const monthText = AppState.filters.period === 'all' 
    ? 'All Time' 
    : getMonthName(AppState.filters.period);

  document.getElementById('kpi-income-subtext').innerHTML = `<i class="fa-solid fa-caret-up"></i> Inflow for ${monthText}`;
  document.getElementById('kpi-expense-subtext').innerHTML = `<i class="fa-solid fa-caret-down"></i> Outflow for ${monthText}`;
}

function updateMonthlySelector() {
  const select = document.getElementById('monthly-filter-select');
  const previousValue = select.value;

  // Find all distinct months in transaction dates
  const monthsSet = new Set();
  AppState.transactions.forEach(t => {
    if (t.date) {
      monthsSet.add(t.date.substring(0, 7)); // Store YYYY-MM
    }
  });

  const sortedMonths = Array.from(monthsSet).sort().reverse(); // Show latest months first

  // Re-build dropdown items
  select.innerHTML = '<option value="all">All Time</option>';
  sortedMonths.forEach(m => {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = getMonthName(m);
    select.appendChild(option);
  });

  // Keep selection matching previous filter or fallback to all
  if (Array.from(select.options).some(o => o.value === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = 'all';
    AppState.filters.period = 'all';
  }
}

function updateCategoriesDropdowns() {
  const ledgerSelect = document.getElementById('ledger-category-select');
  const activeVal = ledgerSelect.value;

  ledgerSelect.innerHTML = '<option value="all">All Categories</option>';
  AppState.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    ledgerSelect.appendChild(opt);
  });

  if (Array.from(ledgerSelect.options).some(o => o.value === activeVal)) {
    ledgerSelect.value = activeVal;
  } else {
    ledgerSelect.value = 'all';
    AppState.filters.category = 'all';
  }
}

function renderTransactionTable() {
  const tbody = document.getElementById('transaction-table-body');
  tbody.innerHTML = '';

  const totalItems = AppState.filteredTransactions.length;
  const startIndex = (AppState.currentPage - 1) * AppState.pageSize;
  const endIndex = Math.min(startIndex + AppState.pageSize, totalItems);

  // Update pagination footer display labels
  const pageInfo = document.getElementById('ledger-pagination-info');
  if (totalItems === 0) {
    pageInfo.textContent = 'Showing 0 transactions';
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">
      <i class="fa-solid fa-receipt" style="font-size: 24px; margin-bottom: 8px; display: block;"></i> No transactions found matches this filter.
    </td></tr>`;
    document.getElementById('prev-page-btn').disabled = true;
    document.getElementById('next-page-btn').disabled = true;
    return;
  }

  pageInfo.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalItems} transactions`;
  document.getElementById('prev-page-btn').disabled = AppState.currentPage === 1;
  document.getElementById('next-page-btn').disabled = endIndex >= totalItems;

  const pageTxs = AppState.filteredTransactions.slice(startIndex, endIndex);

  pageTxs.forEach(t => {
    // Match category configuration details (to extract color code & font awesome glyphs)
    const categoryInfo = AppState.categories.find(c => c.name === t.category) || {
      color: '#64748b',
      icon: 'fa-circle-question'
    };

    const row = document.createElement('tr');
    
    // Formatting date & time
    let dateFormatted;
    try {
      const dateObj = new Date(t.date);
      const hasTime = t.date && (t.date.includes('T') || t.date.includes(' '));
      if (hasTime) {
        dateFormatted = dateObj.toLocaleString('en-IN', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      } else {
        dateFormatted = dateObj.toLocaleDateString('en-IN', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC'
        });
      }
    } catch (e) {
      dateFormatted = t.date;
    }

    row.innerHTML = `
      <td>${dateFormatted}</td>
      <td>
        <div class="tx-category-cell">
          <div class="category-icon-badge" style="background-color: ${categoryInfo.color}">
            <i class="fa-solid ${categoryInfo.icon}"></i>
          </div>
          <span>${t.category}</span>
        </div>
      </td>
      <td>
        <span class="tx-desc">${t.description || 'No Description'}</span>
      </td>
      <td>
        <span class="tx-amount ${t.type}">${formatCurrency(t.amount)}</span>
      </td>
      <td>
        <div class="tx-actions">
          <button class="action-btn edit" data-id="${t.id}" title="Edit Transaction">
            <i class="fa-regular fa-pen-to-square"></i>
          </button>
          <button class="action-btn delete" data-id="${t.id}" title="Delete Transaction">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });

  // Attach action bindings
  tbody.querySelectorAll('.action-btn.edit').forEach(btn => {
    btn.addEventListener('click', () => openEditTransactionModal(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-btn.delete').forEach(btn => {
    btn.addEventListener('click', () => deleteTransactionHandler(btn.getAttribute('data-id')));
  });
}

function updateAppUI() {
  updateKPIs();
  updateMonthlySelector();
  updateCategoriesDropdowns();
  renderTransactionTable();
  updateCharts();
  updateConnectionStatusUI();
}

// ==========================================================================
// EVENT HANDLERS & MODAL OPERATIONS
// ==========================================================================

// Close active modal helper
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  document.getElementById('modal-backdrop').classList.remove('active');
}

// Show modal helper
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
  document.getElementById('modal-backdrop').classList.add('active');
}

// 1. Transaction Form Modal Controls
const txModal = document.getElementById('transaction-modal');
const categoryInput = document.getElementById('tx-category-input');

function selectCategoryInPicker(catName) {
  categoryInput.value = catName;
  document.querySelectorAll('.category-item-select').forEach(el => {
    if (el.getAttribute('data-name') === catName) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

// Populate Category Picker inside transaction form dynamically
function renderCategoryPicker(type) {
  const pickerGrid = document.getElementById('tx-category-picker');
  pickerGrid.innerHTML = '';

  const matchedCats = AppState.categories.filter(c => c.type === type);

  matchedCats.forEach(c => {
    const item = document.createElement('div');
    item.className = 'category-item-select';
    item.setAttribute('data-name', c.name);
    item.innerHTML = `
      <div class="icon-circle" style="background-color: ${c.color}">
        <i class="fa-solid ${c.icon}"></i>
      </div>
      <span>${c.name}</span>
    `;

    item.addEventListener('click', () => selectCategoryInPicker(c.name));
    pickerGrid.appendChild(item);
  });

  // Clear past selections or auto-select first category in list
  if (matchedCats.length > 0) {
    selectCategoryInPicker(matchedCats[0].name);
  } else {
    categoryInput.value = '';
  }
}

// Set up transaction forms for Add Income or Add Expense
function openAddTransactionModal(type = 'expense') {
  document.getElementById('tx-modal-title').innerHTML = `<i class="fa-solid fa-circle-${type === 'income' ? 'plus' : 'minus'}"></i> Add ${type === 'income' ? 'Income' : 'Expense'}`;
  document.getElementById('transaction-form').reset();
  document.getElementById('tx-id-input').value = '';
  document.getElementById('tx-date-input').value = getLocalDateTimeString();

  // Highlight segment button
  document.querySelectorAll('#transaction-modal .segment-btn').forEach(btn => {
    if (btn.getAttribute('data-value') === type) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderCategoryPicker(type);
  openModal('transaction-modal');
}

// Load transaction data and update modal details for Editing records
function openEditTransactionModal(id) {
  const tx = AppState.transactions.find(t => t.id === id);
  if (!tx) return;

  document.getElementById('tx-modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Record`;
  document.getElementById('tx-id-input').value = tx.id;
  document.getElementById('tx-amount-input').value = tx.amount;
  
  let dateVal = tx.date;
  if (dateVal && dateVal.length === 10) {
    dateVal = dateVal + 'T00:00';
  } else if (dateVal && dateVal.length > 16) {
    dateVal = dateVal.substring(0, 16);
  }
  document.getElementById('tx-date-input').value = dateVal || getLocalDateTimeString();
  document.getElementById('tx-desc-input').value = tx.description || '';

  // Highlight segmented buttons
  document.querySelectorAll('#transaction-modal .segment-btn').forEach(btn => {
    if (btn.getAttribute('data-value') === tx.type) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderCategoryPicker(tx.type);
  selectCategoryInPicker(tx.category);
  openModal('transaction-modal');
}

async function deleteTransactionHandler(id) {
  if (confirm('Are you sure you want to permanently delete this transaction record?')) {
    try {
      await APIService.deleteTransaction(id);
      showToast('Record deleted successfully', 'success');
      await AppState.reloadData();
      updateAppUI();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }
}

// Build color options in category manager modal dynamically
function populateCategoryCreatorAssets() {
  const colors = ['#6366f1', '#10b981', '#f43f5e', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#0ea5e9', '#14b8a6', '#84cc16', '#f97316', '#64748b'];
  const icons = ['fa-tag', 'fa-briefcase', 'fa-utensils', 'fa-house', 'fa-bolt', 'fa-film', 'fa-bag-shopping', 'fa-car', 'fa-heart-pulse', 'fa-graduation-cap', 'fa-plane', 'fa-gifts', 'fa-dumbbell', 'fa-spa', 'fa-paw', 'fa-gamepad'];

  const colorPalette = document.getElementById('cat-color-palette');
  colorPalette.innerHTML = '';
  colors.forEach(col => {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.backgroundColor = col;
    dot.setAttribute('data-color', col);
    if (col === '#6366f1') dot.classList.add('active');

    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      document.getElementById('cat-color-input').value = col;
    });
    colorPalette.appendChild(dot);
  });

  const iconGrid = document.getElementById('cat-icon-selector');
  iconGrid.innerHTML = '';
  icons.forEach(ico => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-option-btn';
    btn.setAttribute('data-icon', ico);
    btn.innerHTML = `<i class="fa-solid ${ico}"></i>`;
    if (ico === 'fa-tag') btn.classList.add('active');

    btn.addEventListener('click', () => {
      document.querySelectorAll('.icon-option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('cat-icon-input').value = ico;
    });
    iconGrid.appendChild(btn);
  });
}

// ==========================================================================
// TOAST ALERT NOTIFICATIONS
// ==========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('alert-container');
  const toast = document.createElement('div');
  toast.className = `alert-toast ${type}`;

  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';
  if (type === 'warning') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(amount);
}

function getMonthName(yearMonthStr) {
  const [year, month] = yearMonthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalDateTimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// ==========================================================================
// EVENT LISTENERS INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize theme
  ThemeManager.init();

  // Initialize services
  await APIService.init();

  // Setup Auth screen UI
  const authSection = document.getElementById('auth-section');
  const appSection = document.getElementById('app-section');

  const loginCard = document.getElementById('login-card');
  const registerCard = document.getElementById('register-card');

  // Toggle Forms on Auth Screens
  document.getElementById('go-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    loginCard.style.display = 'none';
    registerCard.style.display = 'block';
  });

  document.getElementById('go-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    registerCard.style.display = 'none';
    loginCard.style.display = 'block';
  });

  // Password visibility triggers
  document.getElementById('login-pass-toggle').addEventListener('click', function() {
    const input = document.getElementById('login-password');
    const eye = this.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      eye.className = 'fa-regular fa-eye-slash';
    } else {
      input.type = 'password';
      eye.className = 'fa-regular fa-eye';
    }
  });

  document.getElementById('register-pass-toggle').addEventListener('click', function() {
    const input = document.getElementById('register-password');
    const eye = this.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      eye.className = 'fa-regular fa-eye-slash';
    } else {
      input.type = 'password';
      eye.className = 'fa-regular fa-eye';
    }
  });

  // Forgot Password Modal Controls
  document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('forgot-password-form').reset();
    openModal('forgot-password-modal');
  });

  document.getElementById('forgot-password-close-btn').addEventListener('click', () => {
    closeModal('forgot-password-modal');
  });

  document.getElementById('forgot-password-cancel-btn').addEventListener('click', () => {
    closeModal('forgot-password-modal');
  });

  document.getElementById('forgot-pass-toggle').addEventListener('click', function() {
    const input = document.getElementById('forgot-new-password');
    const eye = this.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      eye.className = 'fa-regular fa-eye-slash';
    } else {
      input.type = 'password';
      eye.className = 'fa-regular fa-eye';
    }
  });

  document.getElementById('forgot-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userVal = document.getElementById('forgot-username').value.trim();
    const newPassVal = document.getElementById('forgot-new-password').value;

    try {
      await APIService.resetPassword(userVal, newPassVal);
      showToast('Password reset successful! Please login with your new password.', 'success');
      closeModal('forgot-password-modal');
      document.getElementById('login-username').value = userVal;
      document.getElementById('login-password').value = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Submission handles: Login Form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userVal = document.getElementById('login-username').value.trim();
    const passVal = document.getElementById('login-password').value;

    try {
      const user = await APIService.login(userVal, passVal);
      showToast(`Welcome back, ${user.fullName}!`, 'success');
      enterAppSession();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Submission handles: Register Form
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameVal = document.getElementById('register-fullname').value.trim();
    const userVal = document.getElementById('register-username').value.trim();
    const passVal = document.getElementById('register-password').value;

    try {
      await APIService.register(userVal, passVal, nameVal);
      showToast('Registration successful! Please login.', 'success');
      registerCard.style.display = 'none';
      loginCard.style.display = 'block';
      document.getElementById('login-username').value = userVal;
      document.getElementById('login-password').value = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Google Sign-In & Sign-Up Handlers
  const handleGoogleAuth = async () => {
    try {
      const user = await APIService.loginWithGoogle();
      showToast(`Welcome, ${user.fullName}!`, 'success');
      enterAppSession();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showToast(err.message, 'error');
      }
    }
  };

  document.getElementById('google-signin-btn').addEventListener('click', handleGoogleAuth);
  document.getElementById('google-signup-btn').addEventListener('click', handleGoogleAuth);

  // Logout Trigger
  document.getElementById('logout-btn').addEventListener('click', () => {
    APIService.logout();
    showToast('Logged out successfully', 'info');
    exitAppSession();
  });

  // Setup App core views toggle
  async function enterAppSession() {
    authSection.style.display = 'none';
    appSection.style.display = 'block';
    
    // Set Profile UI elements
    const user = APIService.currentUser;
    document.getElementById('user-display-name').textContent = user.fullName;
    document.getElementById('user-avatar').textContent = user.fullName.charAt(0).toUpperCase();
    document.getElementById('welcome-message').textContent = `Hello, ${user.fullName}!`;

    // Load active finance data
    await AppState.reloadData();
    updateAppUI();
  }

  function exitAppSession() {
    appSection.style.display = 'none';
    authSection.style.display = 'flex';
    document.getElementById('login-form').reset();
    document.getElementById('register-form').reset();
  }

  // Auto-login if user is already signed in
  if (APIService.currentUser) {
    try {
      await enterAppSession();
      showToast(`Welcome back, ${APIService.currentUser.fullName}!`, 'success');
    } catch (e) {
      console.error('Failed to auto-login:', e);
      await APIService.logout();
      exitAppSession();
    }
  } else {
    exitAppSession();
  }

  // --- ACTIONS: ADD INCOME / EXPENSE TRIGGER MODALS ---
  document.getElementById('action-add-income-btn').addEventListener('click', () => openAddTransactionModal('income'));
  document.getElementById('action-add-expense-btn').addEventListener('click', () => openAddTransactionModal('expense'));

  // Transaction Form Segmented Inflow/Outflow Buttons
  document.querySelectorAll('#transaction-modal .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#transaction-modal .segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const type = btn.getAttribute('data-value');
      renderCategoryPicker(type);
    });
  });

  // Modal Cancel Triggers
  document.getElementById('tx-modal-close-btn').addEventListener('click', () => closeModal('transaction-modal'));
  document.getElementById('tx-modal-cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    closeModal('transaction-modal');
    closeModal('category-modal');
  });

  // Submission handles: Transaction form
  document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('tx-id-input').value;
    
    // Read segmented button state
    const typeBtn = document.querySelector('#transaction-modal .segment-btn.active');
    const type = typeBtn ? typeBtn.getAttribute('data-value') : 'expense';

    const txPayload = {
      amount: parseFloat(document.getElementById('tx-amount-input').value),
      date: document.getElementById('tx-date-input').value,
      category: categoryInput.value,
      description: document.getElementById('tx-desc-input').value.trim(),
      type
    };

    if (!txPayload.category) {
      showToast('Please select a category', 'warning');
      return;
    }

    try {
      if (id) {
        // Edit flow
        await APIService.updateTransaction(id, txPayload);
        showToast('Transaction updated successfully', 'success');
      } else {
        // New flow
        await APIService.createTransaction(txPayload);
        showToast('Transaction recorded successfully', 'success');
      }
      closeModal('transaction-modal');
      await AppState.reloadData();
      updateAppUI();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // --- ACTIONS: CREATE CUSTOM CATEGORIES ---
  document.getElementById('action-add-category-btn').addEventListener('click', () => {
    populateCategoryCreatorAssets();
    document.getElementById('category-form').reset();
    document.getElementById('cat-color-input').value = '#6366f1';
    document.getElementById('cat-icon-input').value = 'fa-tag';
    openModal('category-modal');
  });

  document.getElementById('cat-modal-close-btn').addEventListener('click', () => closeModal('category-modal'));
  document.getElementById('cat-modal-cancel-btn').addEventListener('click', () => closeModal('category-modal'));

  // Submission handles: Category form
  document.getElementById('category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const catPayload = {
      name: document.getElementById('cat-name-input').value.trim(),
      type: document.getElementById('cat-type-select').value,
      color: document.getElementById('cat-color-input').value,
      icon: document.getElementById('cat-icon-input').value
    };

    try {
      await APIService.createCategory(catPayload);
      showToast(`Category "${catPayload.name}" created!`, 'success');
      closeModal('category-modal');
      await AppState.reloadData();
      updateAppUI();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // --- LEDGER TABLE CONTROLS (SEARCH, FILTERS, SORTS) ---
  document.getElementById('ledger-search-input').addEventListener('input', (e) => {
    AppState.filters.search = e.target.value;
    AppState.currentPage = 1;
    AppState.applyFiltersAndSort();
    renderTransactionTable();
  });

  document.getElementById('ledger-category-select').addEventListener('change', (e) => {
    AppState.filters.category = e.target.value;
    AppState.currentPage = 1;
    AppState.applyFiltersAndSort();
    renderTransactionTable();
  });

  document.getElementById('ledger-sort-select').addEventListener('change', (e) => {
    AppState.sort = e.target.value;
    AppState.applyFiltersAndSort();
    renderTransactionTable();
  });

  document.getElementById('monthly-filter-select').addEventListener('change', (e) => {
    AppState.filters.period = e.target.value;
    AppState.currentPage = 1;
    AppState.applyFiltersAndSort();
    updateKPIs();
    renderTransactionTable();
    updateCharts();
  });

  // Type Filter buttons
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      AppState.filters.type = btn.getAttribute('data-type');
      AppState.currentPage = 1;
      AppState.applyFiltersAndSort();
      renderTransactionTable();
    });
  });

  // Pagination buttons
  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (AppState.currentPage > 1) {
      AppState.currentPage--;
      renderTransactionTable();
    }
  });

  document.getElementById('next-page-btn').addEventListener('click', () => {
    const totalItems = AppState.filteredTransactions.length;
    if (AppState.currentPage * AppState.pageSize < totalItems) {
      AppState.currentPage++;
      renderTransactionTable();
    }
  });

  // CSV Export
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    if (AppState.filteredTransactions.length === 0) {
      showToast('No transaction rows matching filter to export', 'warning');
      return;
    }
    
    // Generate CSV contents
    let csvContent = "\uFEFF"; // Add UTF-8 BOM for Microsoft Excel compatibility
    csvContent += "Date,Type,Category,Description,Amount\n";
    AppState.filteredTransactions.forEach(t => {
      const escapedDesc = (t.description || '').replace(/"/g, '""');
      const row = `"${t.date}","${t.type}","${t.category}","${escapedDesc}",${t.amount}`;
      csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `apexfinance_ledger_${getLocalDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Ledger exported successfully!', 'success');
  });
});
