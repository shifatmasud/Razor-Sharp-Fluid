
import React from 'react';
import FluidCanvas from '../Core/FluidCanvas/FluidCanvas';
import { useTheme } from '../../theme/Theme';

const Header = () => {
    const theme = useTheme();
    const style = {
        position: 'absolute' as const,
        top: 24,
        left: 24,
        zIndex: 10,
        pointerEvents: 'none' as const,
        textShadow: '0 2px 10px rgba(0,0,0,0.2)'
    };

    return (
        <header style={style}>
            <h1 style={{ 
                ...theme.typography.headline.m, 
                margin: 0, 
                color: 'rgba(255,255,255,0.9)', 
                fontWeight: 300,
                letterSpacing: '-0.5px'
            }}>
                Fluid Interaction <span style={{ opacity: 0.4, fontWeight: 400 }}>10</span>
            </h1>
        </header>
    );
};

interface Config {
    densityDissipation: number;
    splatRadius: number;
}

const HomePage = () => {
    const theme = useTheme();
    
    // Configuration for the fluid simulation.
    // densityDissipation controls how quickly the trail fades. A value closer to 1 means a longer trail.
    const config: Config = {
        densityDissipation: 0.95, 
        splatRadius: 40,
    };

    const imageUrl = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=2070&auto=format&fit=crop';

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: theme.colors.base.surface[1], overflow: 'hidden' }}>
            <FluidCanvas config={config} imageUrl={imageUrl} />
            <Header />
        </div>
    );
};

export default HomePage;