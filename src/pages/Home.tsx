import { Link } from 'react-router-dom'

const Welcome = () => {
    return (
        <main>
            <h1>Welcome to Portable Media</h1>
            <p>This software is in beta and works best with chromium browsers like Edge and Chrome</p>
            <section className="flex flex-col">
              <Link to="/controller">Controller</Link>
              <Link to="/monitor">Monitor</Link>
              <Link to="/presentation">Presentation</Link>
              <Link to="/overlays">Overlays</Link>
            </section>

        </main>

    )
}

export default Welcome