import { app } from '../vehapiproxi/src/function.js';

export default function handler(req, res) {
    return app(req, res);
}
