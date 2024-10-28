import './App.css';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Controller from './pages/Controller';
import Presentation from './pages/Presentation';
import Monitor from './pages/Monitor';
import Stream from './pages/Stream';
import { Provider } from 'react-redux';
import store from './store/store';

function App() {
  return (
    <Provider store={store}>
      <Router>
        <Routes>
          <Route path="/" element={<Home/>} />
          <Route path="/controller" element={<Controller/>} />
          <Route path="/presentation" element={<Presentation/>} />
          <Route path="/monitor" element={<Monitor/>} />
          <Route path="/stream" element={<Stream/>} />
        </Routes>
      </Router>
    </Provider>
  );
}

export default App;
