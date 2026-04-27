const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db, initDatabase, queries } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Disable foreign key constraints for MVP (prevents household_id errors on new users)
db.pragma('foreign_keys = OFF');

// ===================== STATIC FILES =====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ===================== USERS =====================
app.get('/api/users', (req, res) => {
  try {
    if (req.query.phone) {
      const user = queries.getUserByPhone.get(req.query.phone);
      return res.json({ success: true, user: user || null });
    }
    const users = queries.getAllUsers.all();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/users', (req, res) => {
  try {
    const { name, phone, role, bio = '', skills = '' } = req.body;
    if (!name || !phone || !role) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    let user = queries.getUserByPhone.get(phone);
    if (user) {
      // Update existing user
      queries.updateUser.run(name, bio, skills, user.id);
      user = queries.getUserById.get(user.id);
      return res.json({ success: true, user, existing: true });
    }

    // Create new user
    const id = 'user_' + uuidv4().split('-')[0];
    const balance = role === 'professional' ? 0 : 0;
    queries.createUser.run(id, name, phone, role, bio, skills, balance);
    user = queries.getUserById.get(id);
    res.json({ success: true, user, existing: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/users/:id/delete', (req, res) => {
  try {
    queries.deleteUser.run(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== GIGS =====================
app.get('/api/gigs', (req, res) => {
  try {
    const gigs = queries.getAllGigs.all();
    // Parse completed_by JSON
    const parsed = gigs.map(g => ({
      ...g,
      completed_by: JSON.parse(g.completed_by || '[]')
    }));
    res.json({ success: true, gigs: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gigs', (req, res) => {
  try {
    const { title, category, urgency = 'normal', description, household_id, household_name } = req.body;
    if (!title || !category || !description || !household_id) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Ensure user exists (create if not) to prevent foreign key issues
    let user = queries.getUserById.get(household_id);
    if (!user && household_name) {
      // Create a placeholder user if they don't exist
      const phone = 'temp_' + Date.now();
      queries.createUser.run(household_id, household_name, phone, 'household', '', '', 0);
    }

    const id = 'gig_' + uuidv4().split('-')[0];
    queries.createGig.run(id, title, category, urgency, description, 'open', household_id, household_name, '[]', new Date().toISOString());
    const gig = queries.getGigById.get(id);
    res.json({ success: true, gig: { ...gig, completed_by: [] } });
  } catch (err) {
    console.error('Error creating gig:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gigs/:id/accept', (req, res) => {
  try {
    const { professional_id } = req.body;
    const gig = queries.getGigById.get(req.params.id);
    if (!gig) return res.status(404).json({ success: false, error: 'Gig not found' });
    if (gig.status !== 'open') return res.status(400).json({ success: false, error: 'Gig not available' });

    const pro = queries.getUserById.get(professional_id);
    if (!pro) return res.status(404).json({ success: false, error: 'Professional not found' });
    if (pro.balance < 10) return res.status(400).json({ success: false, error: 'Insufficient balance. Minimum MAD 10 required.' });

    // Track acceptance in completed_by temporarily (stores pro ID as first accept)
    let accepted = JSON.parse(gig.completed_by || '[]');
    if (!accepted.includes(professional_id)) {
      accepted.push(professional_id);
    }
    queries.updateCompletedBy.run(JSON.stringify(accepted), req.params.id);

    const updated = queries.getGigById.get(req.params.id);
    res.json({ success: true, gig: { ...updated, completed_by: JSON.parse(updated.completed_by || '[]') } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gigs/:id/select', (req, res) => {
  try {
    const { professional_id, professional_name } = req.body;
    const gig = queries.getGigById.get(req.params.id);
    if (!gig) return res.status(404).json({ success: false, error: 'Gig not found' });

    queries.assignProfessional.run(professional_id, professional_name, req.params.id);

    // Add system message to chat
    queries.createMessage.run(req.params.id, 'system', 'System', 
      `Chat opened. ${professional_name} has been selected for this gig.`, 
      new Date().toISOString()
    );

    const updated = queries.getGigById.get(req.params.id);
    res.json({ success: true, gig: { ...updated, completed_by: JSON.parse(updated.completed_by || '[]') } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gigs/:id/complete', (req, res) => {
  try {
    const { user_id } = req.body;
    const gig = queries.getGigById.get(req.params.id);
    if (!gig) return res.status(404).json({ success: false, error: 'Gig not found' });
    if (gig.status === 'completed') return res.json({ success: true, gig: { ...gig, completed_by: JSON.parse(gig.completed_by || '[]') }, alreadyCompleted: true });

    let completed = JSON.parse(gig.completed_by || '[]');
    if (!completed.includes(user_id)) {
      completed.push(user_id);
    }
    queries.updateCompletedBy.run(JSON.stringify(completed), req.params.id);

    let result = { completedBy: completed.length, fullyCompleted: false };

    // Check if both parties confirmed
    if (completed.length >= 2 && gig.professional_id) {
      // Deduct commission
      queries.updateBalance.run(-10, gig.professional_id);
      queries.completeGig.run(req.params.id);

      // Add system message
      queries.createMessage.run(req.params.id, 'system', 'System',
        '✅ Gig completed. Commission of MAD 10 deducted. Chat is now locked.',
        new Date().toISOString()
      );

      result.fullyCompleted = true;

      // Check low balance warning
      const pro = queries.getUserById.get(gig.professional_id);
      if (pro && pro.balance <= 50) {
        result.lowBalanceWarning = true;
        result.proBalance = pro.balance;
      }
    }

    const updated = queries.getGigById.get(req.params.id);
    res.json({ success: true, gig: { ...updated, completed_by: JSON.parse(updated.completed_by || '[]') }, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gigs/:id/rate', (req, res) => {
  try {
    const { rating, review = '' } = req.body;
    queries.rateGig.run(rating, review, req.params.id);
    res.json({ success: true, message: 'Rating submitted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/gigs/:id/delete', (req, res) => {
  try {
    queries.deleteGig.run(req.params.id);
    res.json({ success: true, message: 'Gig deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== MESSAGES =====================
app.get('/api/gigs/:id/messages', (req, res) => {
  try {
    const messages = queries.getMessagesByGig.all(req.params.id);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gigs/:id/messages', (req, res) => {
  try {
    const { sender_id, sender_name, text } = req.body;
    if (!text || !sender_id) return res.status(400).json({ success: false, error: 'Missing fields' });

    queries.createMessage.run(req.params.id, sender_id, sender_name, text, new Date().toISOString());
    const messages = queries.getMessagesByGig.all(req.params.id);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== WALLET =====================
app.post('/api/wallet/fund', (req, res) => {
  try {
    const { user_id, amount = 100 } = req.body;
    queries.updateBalance.run(amount, user_id);
    const user = queries.getUserById.get(user_id);
    res.json({ success: true, balance: user.balance, message: `MAD ${amount} deposited` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== CASHPLUS =====================
app.post('/api/cashplus/request', (req, res) => {
  try {
    const { user_id, user_name, amount = 100 } = req.body;
    const reference = 'CP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
    queries.createCashPlus.run(user_id, user_name, amount, reference);
    res.json({ success: true, reference, amount, message: 'Deposit request created. Transfer via CashPlus using this reference.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cashplus/pending', (req, res) => {
  try {
    const deposits = queries.getPendingCashPlus.all();
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cashplus/verify', (req, res) => {
  try {
    const { deposit_id } = req.body;
    const deposit = queries.getCashPlusByRef.get(req.query.reference || deposit_id);
    if (!deposit) return res.status(404).json({ success: false, error: 'Deposit not found' });

    queries.verifyCashPlus.run(deposit.id);
    queries.updateBalance.run(deposit.amount, deposit.user_id);

    const user = queries.getUserById.get(deposit.user_id);
    res.json({ success: true, message: 'Deposit verified and credited', newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== REPORTS =====================
app.get('/api/reports', (req, res) => {
  try {
    const reports = queries.getAllReports.all();
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reports', (req, res) => {
  try {
    const { reporter_id, reporter_name, gig_id, reason, details = '' } = req.body;
    queries.createReport.run(reporter_id, reporter_name, gig_id, reason, details);
    res.json({ success: true, message: 'Report submitted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== STATS =====================
app.get('/api/stats', (req, res) => {
  try {
    const stats = queries.getStats.get();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== START =====================
app.listen(PORT, () => {
  console.log(`🚀 ServiceLink server running on port ${PORT}`);
  console.log(`📱 App: http://localhost:${PORT}`);
  console.log(`🛡️  Admin: http://localhost:${PORT}/admin`);
});

module.exports = app;