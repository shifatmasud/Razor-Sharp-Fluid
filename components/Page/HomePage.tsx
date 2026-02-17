
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
    shrinkRate: number;
    splatRadius: number;
}

const HomePage = () => {
    const theme = useTheme();
    
    // Configuration for the shrinking vector mask effect.
    // shrinkRate controls how quickly the trail erodes from the edges.
    const config: Config = {
        shrinkRate: 0.35, 
        splatRadius: 40,
    };

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: theme.colors.base.surface[1], overflow: 'hidden' }}>
            <FluidCanvas config={config} />
            <Header />
        </div>
    );
};

export default HomePage;