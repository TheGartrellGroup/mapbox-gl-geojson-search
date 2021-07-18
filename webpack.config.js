const path = require('path');
const extract = require("mini-css-extract-plugin");
const miniCSS = require('css-minimizer-webpack-plugin');
const terser = require("terser-webpack-plugin");

module.exports = {
    entry: ['./src/index.js', './styles/main.scss'],
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'mapbox-search.min.js'
    },

    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env']
                    }
                }
            },
            {
                test: /\.(sa|sc|c)ss$/,
                use: [extract.loader, 'css-loader', 'sass-loader']
            }
        ]
    },
    optimization: {
        minimize: true,
        minimizer: [
            new terser(),
            new miniCSS(),
        ],
    },
    plugins: [
        new extract({
            filename: 'mapbox-search.min.css'
        })
    ],
    mode: 'development'
}