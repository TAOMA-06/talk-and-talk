import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import CompanionList from './pages/CompanionList';
import CompanionDetail from './pages/CompanionDetail';
import Order from './pages/Order';
import Chat from './pages/Chat';
import Review from './pages/Review';
import Orders from './pages/Orders';
import Messages from './pages/Messages';
import Profile from './pages/Profile';
import Verify from './pages/Verify';

function App() {
  return (
    <Routes>
      <Route element={<Layout showNav={true} />}>
        <Route path="/" element={<Home />} />
        <Route path="/companions" element={<CompanionList />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route element={<Layout header={{ showBack: true }} showNav={false} />}>
        <Route path="/companion/:id" element={<CompanionDetail />} />
        <Route path="/order/:id" element={<Order />} />
        <Route path="/review/:id" element={<Review />} />
        <Route path="/verify" element={<Verify />} />
      </Route>
      <Route path="/chat/:id" element={<Chat />} />
    </Routes>
  );
}

export default App;
