import {GenerateView, IgnoreViewModel, ViewModelName, ViewModelType} from "../../../../src/index";

@GenerateView({
    model: "heroDetailViewModel",
    filePath: "./test/dist/_autogenerated_viewmodels/heroes",
    mapperPath: "./test/dist/_autogenerated_viewmodels/heroes/mappers"})
export class HeroDetail {

    @IgnoreViewModel()
    public id?: number;

    @ViewModelName("detail")
    public data: string;

    public temp: HeroDetail;
}