"use strict";
import {createViewModelsInternal} from "../src/tasks/createViewModels";
import {Options} from "./tasks/model/options";
import { Transformer } from "./tasks/model/transformer";


export function createViewModels(options: Options): string [] {
    return createViewModelsInternal(options);
}

export function GenerateView(modelName: string): Function {
    return function() {
        var f;
    };
}

export function IgnoreViewModel(modelName?: string): Function  {
    return function() {
        var f;
    };
}

export function ViewModelName(name: string, modelName?: string): Function  {
    return function() {
        var f;
    };
}

export function ViewModelType(type: string, filepath: string, modelName?: string, transformer?: Transformer): Function  {
    return function() {
        var f;
    };
}

export function NeedMapper(): Function  {
    return function() {
        console.log();
        var f;
    };
}



