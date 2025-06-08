// https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/
let pageSource = `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <style>.async-hide { opacity: 0 !important} </style>
        <style>.promo{background:#222528;position:fixed;z-index:1001!important;left:0;top:0;right:0;max-height:48px;min-height:48px;padding-top:0!important;padding-bottom:0!important}.promo,.promo p{-webkit-box-align:center;-ms-flex-align:center;align-items:center}.promo p{font-size:.8125rem;line-height:1rem;color:#fff;margin-bottom:0;margin-top:0;margin:0 auto;display:-webkit-box;display:-ms-flexbox;display:flex;font-weight:700}@media only screen and (max-width:650px){.promo p{font-size:.6875rem}}.promo span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}.promo a{color:#fff!important;text-decoration:underline!important}.promo a.btn{background:#d0021b;padding:7px 20px;text-decoration:none!important;font-weight:700;margin-left:10px;margin-right:10px;white-space:nowrap;border-radius:5px}@media only screen and (max-width:650px){.promo a.btn{font-size:.6875rem;padding:7px 10px}}.promo.container{padding-top:8px;padding-bottom:8px}@media only screen and (min-width:1050px){.promo.container{padding-top:0;padding-bottom:0}}.promo .actions{-ms-flex-wrap:nowrap;flex-wrap:nowrap}.promo .actions__left{-ms-flex-preferred-size:100%;flex-basis:100%;-webkit-box-align:center;-ms-flex-align:center;align-items:center}.promo .actions__right{-ms-flex-preferred-size:40px;flex-basis:40px;margin-top:0;margin-bottom:0;-webkit-box-pack:end;-ms-flex-pack:end;justify-content:flex-end}.promo.hidden{display:none}.promo.show{display:-webkit-box!important;display:-ms-flexbox!important;display:flex!important}.promo.show .container__inner{-webkit-box-flex:1;-ms-flex:1;flex:1}.promo.fixed{position:fixed}.promo.show+header.header{margin-top:48px}.header{background:#fff;-webkit-box-shadow:0 1px 0 #dde2e5;box-shadow:0 1px 0 #dde2e5}.header .actions__left,.header__bottom__events{max-width:100%!important;margin:0}.header .header__events-all{margin:0;display:-webkit-box;display:-ms-flexbox;display:flex;position:relative}.header .header__events-all .header__event-slot{-webkit-box-flex:1;-ms-flex:1 100%;flex:1 100%;border-right:1px solid #dde2e5;margin-top:3px;margin-bottom:3px;padding-left:15px;text-align:left;display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-ms-flex-align:center;align-items:center;padding-right:5px;min-width:300px}.header .header__events-all .header__event-slot:hover{text-decoration:none!important}.header .header__events-all .header__event-slot img{min-width:40px;height:40px}.header .header__events-all .header__event-slot div{margin-left:10px}.header .header__events-all .header__event-slot span{font-weight:700!important;font-size:.75rem;margin-bottom:0!important;margin-top:0;display:block;line-height:1.125rem;text-align:left}.header .header__events-all .header__event-slot p{font-weight:400;font-size:.625rem;line-height:130%!important;color:#495057!important;margin:0}@media only screen and (min-width:1050px){.header .header__events-all .header__event-slot p{font-size:.625rem}}.header .header__events-all .header__event-slot:first-child{padding-left:0}.header .header__events-all .header__event-slot:last-child{padding-right:0;border-right:0}@media only screen and (min-width:1050px){.header__bottom,.header__middle,.header__top{position:relative;white-space:nowrap}}.header__top{padding:10px 0}@media only screen and (min-width:800px){.header__top{padding:5px 0}}.header__bottom{padding:5px 0;z-index:29;max-width:100%}.header__bottom a{font-size:.8125rem}.header__bottom .trending{margin-left:0;margin-right:0}.header__bottom .actions{-webkit-box-align:start;-ms-flex-align:start;align-items:flex-start}.header__bottom .actions__left{max-width:calc(100% + 8px)}@media only screen and (min-width:800px){.header__bottom .actions__left{max-width:calc(100% + 24px)}}.header__bottom .actions__right{-webkit-box-flex:1;-ms-flex:1 1 auto;flex:1 1 auto;display:none}@media only screen and (min-width:1050px){.header__bottom .actions__right{display:-webkit-box;display:-ms-flexbox;display:flex}}.header__middle{display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-orient:horizontal;-webkit-box-direction:normal;-ms-flex-flow:row wrap;flex-flow:row wrap}@media only screen and (min-width:1050px){.header__middle{-ms-flex-wrap:nowrap;flex-wrap:nowrap}}.header__top .actions__left{-webkit-box-align:center;-ms-flex-align:center;align-items:center;-ms-flex-line-pack:center;align-content:center}@media only screen and (min-width:1050px){.header__top .actions__right{max-width:430px}}.no-style.header__nav li:nth-child(3){font-weight:700}.no-style.header__nav li:nth-child(3) a{color:#0e5ef1!important}.header__bottom__events::after{background:-webkit-gradient(linear,left top,right top,color-stop(0,rgba(255,255,255,0)),to(#fff));background:linear-gradient(90deg,rgba(255,255,255,0) 0,#fff 100%);content:'';position:absolute;height:60px;right:10px;width:25px}@media only screen and (min-width:1050px){.header__bottom__events::after{display:none}}.contribute-link{font-weight:400;font-size:.6875rem;color:#000!important;position:relative;padding-left:10px}.contribute-link:hover{color:#00791d!important;text-decoration:none!important}.contribute-link::before{content:'';width:1px;height:12px;position:absolute;top:50%;-webkit-transform:translateY(-50%);transform:translateY(-50%);background:rgba(0,0,0,.1);left:-1px}.my-0{margin-top:0!important;margin-bottom:0!important}.header__desc.my-0{margin-left:0}.header__bottom__events .actions__left{max-width:100%!important;overflow-x:scroll;-ms-overflow-style:none;scrollbar-width:none;display:block;scroll-behavior:smooth;min-width:100%}.header__bottom__events .actions__left::-webkit-scrollbar{display:none}.header__bottom__events .actions__left:-webkit-scrollbar-thumb{background:#fff}.logo{line-height:1rem}.header{position:relative;z-index:41;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}.header .input:focus,.header input[type=password]:focus,.header input[type=text]:focus{border:1px solid #00791d}.header a:not(.button):not(.login__action):not(.active){text-decoration:none;color:#222}.header a:not(.button):not(.login__action):not(.active):hover{text-decoration:underline;color:#222}.header__items{display:none;-ms-flex-wrap:wrap;flex-wrap:wrap}@media only screen and (min-width:1050px){.header__items{display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-orient:horizontal;-webkit-box-direction:normal;-ms-flex-direction:row;flex-direction:row}.header__items nav{position:relative;background:0 0;padding:0;left:0;top:0;line-height:inherit;display:block;-webkit-box-shadow:none;box-shadow:none;max-width:100%;max-height:80px}}.header__items>div{width:100%;margin-bottom:32px;display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-orient:vertical;-webkit-box-direction:normal;-ms-flex-flow:column nowrap;flex-flow:column nowrap}@media only screen and (min-width:552px){.header__items>div:not(:nth-last-child(-n+2)){margin-bottom:32px}}@media only screen and (min-width:552px) and (max-width:1050px){.header__items>div{-webkit-box-flex:0;-ms-flex-positive:0;flex-grow:0;-ms-flex-negative:0;flex-shrink:0;-ms-flex-preferred-size:calc(99.7% * 1/2 - (32px - 32px * 1/2));flex-basis:calc(99.7% * 1/2 - (32px - 32px * 1/2));max-width:calc(99.7% * 1/2 - (32px - 32px * 1/2));width:calc(99.7% * 1/2 - (32px - 32px * 1/2))}.header__items>div:nth-child(1n){margin-right:32px;margin-left:0}.header__items>div:last-child{margin-right:0}.header__items>div:nth-child(2n){margin-right:0;margin-left:auto}}@media only screen and (min-width:800px) and (max-width:1050px){.header__items>div{-webkit-box-flex:0;-ms-flex-positive:0;flex-grow:0;-ms-flex-negative:0;flex-shrink:0;-ms-flex-preferred-size:calc(99.7% * 1/4 - (32px - 32px * 1/4));flex-basis:calc(99.7% * 1/4 - (32px - 32px * 1/4));max-width:calc(99.7% * 1/4 - (32px - 32px * 1/4));width:calc(99.7% * 1/4 - (32px - 32px * 1/4))}.header__items>div:nth-child(1n){margin-right:32px;margin-left:0}.header__items>div:last-child{margin-right:0}.header__items>div:nth-child(4n){margin-right:0;margin-left:auto}}@media only screen and (min-width:1050px){.header__items>div{margin-bottom:0!important;margin-right:0!important;-webkit-box-orient:horizontal;-webkit-box-direction:normal;-ms-flex-direction:row;flex-direction:row}}.header__items .language__switcher{display:none}.header__items .language__switcher .li-nav.active>a,.header__items .language__switcher>li.active>a{color:#fff!important}.header__items .language__switcher .li-nav.active>a:hover,.header__items .language__switcher>li.active>a:hover{color:#fff!important;background:#0e5ef1}.header__items .language__switcher .li-nav:hover>a,.header__items .language__switcher>li:hover>a{color:#fff}.header+main{display:block;min-height:210px;-webkit-transition:margin .15s ease;transition:margin .15s ease;margin-top:0!important}.header--hide .header+main{margin-top:50px}.header--hide .header__toggle{opacity:0;top:20px;visibility:hidden}.header--hide .header__logo{max-height:0}.header--hide .header__middle,.header--hide .header__top{max-height:0;overflow:hidden;padding-top:0;padding-bottom:0;border-color:transparent}.header--hide .header__bottom .vue-portal-target{top:3px;right:0;bottom:auto;left:auto;position:absolute}.header__middle,.header__top{-webkit-transition:all .15s ease;transition:all .15s ease}.header__middle{border-bottom:1px solid rgba(0,0,0,.1);z-index:33}.header__middle .vue-portal-target{width:100%}@media only screen and (min-width:1050px){.header__middle .vue-portal-target{display:none}}@media only screen and (min-width:1050px){.header__middle{line-height:5.75rem;text-align:left;padding:0;z-index:30}.header__middle .widget__heading{display:none}}.header__top>.actions__left{display:none}@media only screen and (min-width:1050px){.header__top>.actions__left{display:-webkit-box;display:-ms-flexbox;display:flex}}.header__top>.actions__right{-webkit-box-flex:1;-ms-flex-positive:1;flex-grow:1;margin-right:0;margin-top:0;margin-bottom:0;-webkit-box-pack:end;-ms-flex-pack:end;justify-content:flex-end}.header__top>.actions__right .dropdown__holder{width:calc(100vw - 16px);max-height:80vh}@media only screen and (min-width:600px){.header__top>.actions__right .dropdown__holder{width:auto}}.header__top>.actions__right>*{margin:0}.header__top>.actions__right .search{display:none}@media only screen and (min-width:1050px){.header__top>.actions__right>*{display:-webkit-box;display:-ms-flexbox;display:flex;white-space:nowrap}.header__top>.actions__right .search{display:block}}.header__top .user__login{display:block}.header__top .user__login>.button,.header__top .user__login>button{border-top-right-radius:0;border-bottom-right-radius:0}@media only screen and (min-width:1050px){.header__top{position:relative;right:auto;width:100%}}.header__logo{max-width:165px;position:absolute;top:8px;overflow:hidden;-webkit-transition:all .1s ease;transition:all .1s ease;z-index:32;line-height:2.25rem;height:36px;width:100px;margin-left:50px;-ms-flex-preferred-size:190px;flex-basis:190px}@media only screen and (min-width:800px){.header__logo{top:4px}}@media only screen and (min-width:1050px){.header__logo{position:relative;top:0;overflow:visible;margin-right:20px;margin-left:0;line-height:3.125rem;height:50px}.header__logo>*{width:165px}}@media only screen and (min-width:1280px){.header__logo{margin-right:30px}}.header__desc,.header__more>button{text-transform:capitalize;color:#666;letter-spacing:0;font-size:0;font-weight:400;line-height:1.5rem;vertical-align:top;font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",system-ui,ui-sans-serif,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";-webkit-transition:font-size .15s ease-in-out;transition:font-size .15s ease-in-out}@media only screen and (min-width:1050px){.header__desc,.header__more>button{font-size:.6875rem}}.header__desc{display:-webkit-inline-box;display:-ms-inline-flexbox;display:inline-flex;position:relative;width:auto}.header__topics{white-space:nowrap;float:right;position:relative}.header__topics *{display:inline-block;vertical-align:top}.header__topics a{font-size:.8125rem}@media only screen and (min-width:1050px){.header__topics{float:none}}.header__more{display:-webkit-inline-box;display:-ms-inline-flexbox;display:inline-flex;vertical-align:top}.header__more:before{left:-12px}.header__more:after,.header__more:before{content:'';width:1px;height:12px;position:absolute;top:50%;-webkit-transform:translateY(-50%);transform:translateY(-50%);background:rgba(0,0,0,.1)}.header__more:after{right:-12px}.header__more:hover{cursor:pointer;color:rgba(0,0,0,.75)}.header__user{display:inline-block;vertical-align:top;white-space:nowrap;margin-left:8px}@media only screen and (min-width:1050px){.header__user{margin-left:0}}.header__user>div{display:inline-block;vertical-align:top}.header__user-nav a:not(.button){text-transform:uppercase;font-size:.75rem;font-weight:600}.header__user-nav a:not(.button):not(.active){opacity:.5}.header__user-nav a:not(.button):not(.active):hover{opacity:.75}.header__user-nav a:not(.button):hover{text-decoration:none}.header__user-nav a:not(.button).active{color:#222;cursor:default;text-decoration:none}.header__user-nav a:not(.button):before{margin-right:0}.header__user-nav a:not(.button):not(:last-child){margin-right:16px}@media only screen and (min-width:1050px){.header__user-nav a:not(.button):not(:last-child){margin-right:32px}}@media only screen and (min-width:1050px){.header__user-nav+.header__topics{margin-left:56px}}.header__search{display:none;vertical-align:top;margin-right:0}@media only screen and (min-width:1050px){.header__search{display:inline-block}}.header__search,.header__user{line-height:inherit}.header__nav{border-bottom:1px solid rgba(0,0,0,.1)}@media only screen and (min-width:800px){.header__nav{border-bottom:0}}.header__nav .button{margin-left:0}.header__nav .button__more{margin-right:20px}.header__nav .li-nav,.header__nav>li{-webkit-transition:all .15s ease;transition:all .15s ease}@media only screen and (min-width:1050px){.header__nav .li-nav,.header__nav>li{display:-webkit-inline-box;display:-ms-inline-flexbox;display:inline-flex;vertical-align:middle;position:static;border:none;min-height:65px}.header__nav .li-nav:hover.has--subnav .nav .li-nav,.header__nav .li-nav:hover.has--subnav .nav>li,.header__nav>li:hover.has--subnav .nav .li-nav,.header__nav>li:hover.has--subnav .nav>li{white-space:normal}.header__nav .li-nav:hover.has--subnav .nav__subnav,.header__nav>li:hover.has--subnav .nav__subnav{opacity:1;top:100%;visibility:visible;-webkit-transition-delay:.25s;transition-delay:.25s}.header__nav .li-nav:hover.has--subnav .nav__category,.header__nav>li:hover.has--subnav .nav__category{width:100%}.header__nav .li-nav:hover.has--subnav .nav__category:after,.header__nav .li-nav:hover.has--subnav .nav__category:before,.header__nav>li:hover.has--subnav .nav__category:after,.header__nav>li:hover.has--subnav .nav__category:before{-webkit-transition-delay:.25s;transition-delay:.25s;opacity:1}}@media only screen and (min-width:1080px){.header__nav .li-nav:not(:last-child),.header__nav>li:not(:last-child){margin-right:23px;margin-left:23px}}@media only screen and (min-width:1280px){.header__nav .li-nav:not(:last-child),.header__nav>li:not(:last-child){margin-right:23px;margin-left:23px}}@media only screen and (min-width:1338px){.header__nav .li-nav:not(:last-child),.header__nav>li:not(:last-child){margin-right:23px;margin-left:23px}}.header__nav .li-nav>a,.header__nav>li>a{font-size:.875rem;line-height:1.5rem;padding:12px 0;color:#000;display:inline-block;max-width:100%;position:relative;z-index:61;white-space:normal}@media only screen and (min-width:1050px){.header__nav .li-nav>a,.header__nav>li>a{padding:8px 0 0;font-weight:700}}.header__nav .li-nav>a:after,.header__nav .li-nav>a:before,.header__nav>li>a:after,.header__nav>li>a:before{content:'';position:absolute;bottom:-1px;left:50%;width:0;height:0;opacity:0;-webkit-transform:translateX(-50%);transform:translateX(-50%);border-style:solid;border-width:0 5px 5px 5px;-webkit-transition:opacity .15s ease-in-out;transition:opacity .15s ease-in-out;border-color:transparent transparent #fff transparent}.header__nav .li-nav>a:before,.header__nav>li>a:before{left:50%;bottom:0;border-width:0 6px 6px 6px;border-color:transparent transparent #f5f7f8 transparent}@media only screen and (min-width:1050px){.header__nav .li-nav>a,.header__nav>li>a{font-size:1rem}}@media only screen and (min-width:1800px){.header__nav .li-nav>a,.header__nav>li>a{font-size:1.125rem}}.header--open{overflow:hidden}@media only screen and (min-width:600px){.header--open{overflow:visible}}.header--open .content-items{max-height:215px;margin:12px 0 24px}.header--open .search{margin-top:16px;display:block}.header--open .header__toggle:before{z-index:10}.header--open .header__toggle>span:nth-child(1){top:50%;-webkit-transform:rotate(45deg);transform:rotate(45deg)}.header--open .header__toggle>span:nth-child(2){opacity:0}.header--open .header__toggle>span:nth-child(3){top:50%;-webkit-transform:rotate(-45deg);transform:rotate(-45deg)}.header--open .header__items,.header--open .header__items .language__switcher{display:-webkit-box;display:-ms-flexbox;display:flex}.header--open .header__top{z-index:100;position:absolute;left:0;right:8px;background:#fff}@media only screen and (min-width:800px){.header--open .header__top{right:20px}}.header--open .header__top .search{display:none}.header--open .header__logo{z-index:101}.header--open .header__middle{padding-top:60px}.header--open .header__bottom{display:none}.header--open .header__container{max-height:90vh;overflow-x:hidden;overflow-y:auto}@media only screen and (min-width:1050px){.header--open .header__container{overflow:visible}}.header .subnav{position:absolute;-webkit-box-shadow:0 5px 25px 1px rgba(0,0,0,.15);box-shadow:0 5px 25px 1px rgba(0,0,0,.15);background:#fff;visibility:hidden;line-height:1.75rem;max-width:100%;width:100%;left:0;opacity:0;overflow:hidden;border:1px solid #f5f7f8;border-radius:2px;-webkit-transition:all .15s ease-in-out;transition:all .15s ease-in-out;top:105%;z-index:60;display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-orient:horizontal;-webkit-box-direction:normal;-ms-flex-flow:row nowrap;flex-flow:row nowrap;-webkit-box-align:stretch;-ms-flex-align:stretch;align-items:stretch}.header .subnav .subnav__categories{-webkit-box-flex:0;-ms-flex:0 1 280px;flex:0 1 280px;padding:24px 0;background:#f5f7f8;margin-right:0!important}.header .subnav .subnav__categories>li{display:block;font-size:.9375rem;padding:2px 48px 2px 24px}.header .subnav .subnav__categories>li a{display:block;font-weight:700}.header .subnav .subnav__categories>li:hover{background:#e1e1e1}.header .subnav .subnav__heading{margin-bottom:20px}.header .subnav .subnav__content{position:relative;-ms-flex-item-align:start;align-self:flex-start;padding:24px;display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-orient:horizontal;-webkit-box-direction:normal;-ms-flex-flow:row wrap;flex-flow:row wrap}@media only screen and (min-width:1050px){.header .subnav .subnav__content{padding-left:32px;padding-right:32px;margin:0 auto;-webkit-box-flex:1;-ms-flex:1 1 600px;flex:1 1 600px}}.header .subnav .subnav__content .heading__container{-ms-flex-preferred-size:100%;flex-basis:100%}.header .subnav .subnav__content:before{content:'';position:absolute;left:0;top:0;bottom:-100%;width:1px;background:rgba(0,0,0,.1)}.languagesEdition .active{font-weight:700}.header__more.dropdown:after{content:'';display:inline-block;vertical-align:middle;-ms-flex-item-align:center;-ms-grid-row-align:center;align-self:center;background-repeat:no-repeat;background-position:center;margin-bottom:2px;width:7px;height:7px;-webkit-transition:-webkit-transform .15s ease;transition:-webkit-transform .15s ease;transition:transform .15s ease;transition:transform .15s ease,-webkit-transform .15s ease;background-color:#fff!important;background-size:contain}.header__more.dropdown button{color:#000!important;margin-right:-20px;padding-right:20px;z-index:1000}.header__more.dropdown .dropdown__holder{width:165px}.header__more.dropdown .dropdown__content{padding:13px;padding-top:5px;padding-bottom:5px}.header__more.dropdown .languagesEdition li{border-bottom:1px solid #e6e6e6}.header__more.dropdown .languagesEdition li:last-child{border:0}.logo__data{display:none;color:#666;font-size:.6875rem}@media only screen and (min-width:1050px){.logo__data{display:block;line-height:.8125rem}}.container{padding-left:12px;padding-right:12px;margin:0 auto;min-width:320px;-webkit-transition:padding .15s ease-in-out;transition:padding .15s ease-in-out}@media only screen and (min-width:600px){.container{padding-left:16px;padding-right:16px}}@media only screen and (min-width:800px){.container{padding-left:20px;padding-right:20px}}@media only screen and (min-width:1250px){.container{padding-left:60px;padding-right:60px}}@media only screen and (min-width:1400px){.container{padding-left:20px;padding-right:20px}}.container.white{background:#fff}.container__inner{max-width:1290px;margin:0 auto;-webkit-transition:max-width .15s ease-out;transition:max-width .15s ease-out}.search{display:block;position:relative;z-index:33;width:100%;max-width:100%;margin:0}.search:before{position:absolute;top:50%;right:24px;-webkit-transform:translateY(-50%);transform:translateY(-50%);margin-right:0;z-index:34}.search__bar{display:block;border-radius:2px;position:relative;z-index:33}.search__bar #search{margin-bottom:0;max-width:100%;background:#fff}.search__go{top:50%;right:0;bottom:0;left:auto;position:absolute;-webkit-transform:translateY(-50%);transform:translateY(-50%);z-index:32;-webkit-appearance:none;-moz-appearance:none;appearance:none;width:36px;height:36px;line-height:2.25rem;-webkit-box-shadow:none;box-shadow:none;display:block;background:0 0;border:0;font-size:0}@media only screen and (min-width:600px){.search__go{z-index:35}}.header #search,.search__go:hover{cursor:pointer}.header #search{height:36px;position:relative;max-width:100%;background-color:#f5f7f8!important}@media only screen and (min-width:600px){.header #search{font-size:.8125rem;min-width:165px;max-width:100%;opacity:1}}.header #search:hover{cursor:auto}@media only screen and (min-width:1050px){.header #search{margin-left:auto;border-top-right-radius:0;border-bottom-right-radius:0;border-right:0}.header #search:focus{min-width:215px}}.header #search:focus{cursor:auto}.header #search .field__desc{display:none}.header #searchForm{width:100%;margin-top:8px}.header #searchForm:before{right:8px}@media only screen and (min-width:600px){.header #searchForm{margin-top:16px}}@media only screen and (min-width:1050px){.header #searchForm{margin-top:0}}</style>
        <script>(function(a,s,y,n,c,h,i,d,e){s.className+=' '+y;h.start=1*new Date;
            h.end=i=function(){s.className=s.className.replace(RegExp(' ?'+y),'')};
            (a[n]=a[n]||[]).hide=h;setTimeout(function(){i();h.end=null},c);h.timeout=c;
        })(window,document.documentElement,'async-hide','dataLayer',4000,
                {'GTM-W9GJ5DL':true});</script>

        <script type="text/javascript">

            var loggedIn = true;
            if (loggedIn) {
                var userCountryId = '47';
            }
        </script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('config', 'G-VMVPD4D2JY');

  //CookieControl tool recomendation
  // Call the default command before gtag.js or Tag Manager runs to
  // adjust how the tags operate when they run. Modify the defaults
  // per your business requirements and prior consent granted/denied, e.g.:
  gtag('consent', 'default', {
      'ad_storage': 'denied',
      'ad_user_data': 'denied',
      'ad_personalization': 'denied',
      'analytics_storage': 'denied'
  });

  if((typeof loggedIn != "undefined") && loggedIn){
      window.dataLayer.push({'logged_in': 'true'});
  } else {
      window.dataLayer.push({'logged_in': 'false'});
  }

  window.dataLayer.push({'show_queryz': ''});
</script>

<!-- Google Tag Manager -->
<script>
var gtmProfile="GTM-W9GJ5DL";
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer', gtmProfile);</script>
<!-- End Google Tag Manager -->

        <title>Amazon Introduces Storage Browser for S3 - InfoQ</title>
        <link rel="canonical" href="https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/"/>
        <link rel="alternate" href="https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/" hreflang="en"/>













            <link rel="alternate" href="https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/" hreflang="x-default" />

















<meta http-equiv="pragma" content="no-cache" />
<meta http-equiv="cache-control" content="private,no-cache,no-store,must-revalidate" />
<meta http-equiv="expires" content="0" />
<meta http-equiv="content-type" content="text/html; charset=utf-8" />
<meta name="copyright" content="&copy; 2006 C4Media" />

<meta name="google-site-verification" content="0qInQx_1WYOeIIbxnh7DnXlw1XOxNgAYakO2k4GhNnY" />
<meta name="msapplication-TileColor" content="#ffffff"/>
<meta name="msapplication-TileImage" content="/styles/static/images/logo/logo.jpg"/>
<meta property="wb:webmaster" content="3eac1729a8bbe046" />
<meta content="width=device-width,initial-scale=1" name="viewport">
<meta http-equiv="X-UA-Compatible" content="IE=10, IE=edge">


        <link rel="stylesheet" type="text/css" media="screen" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/style.css"/>
        <link rel="stylesheet" type="text/css" media="print" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/print.css"/>
        <link rel="preload" type="text/css" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/style_en.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
        <link rel="preload" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/icons.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
        <link rel="preload" type="text/css" media="screen" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/style_extra.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
        <noscript>
            <link rel="stylesheet" type="text/css" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/style_en.css"/>
            <link rel="stylesheet" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/icons.css">
            <link rel="stylesheet" type="text/css" media="screen" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/style_extra.css"/>
        </noscript>

        <link rel="stylesheet" type="text/css" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/fonts/font.css"/>

        <link rel="shortcut icon" href="https://cdn.infoq.com/statics_s2_20240917061620/favicon.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="https://cdn.infoq.com/statics_s2_20240917061620/apple-touch-icon.png"/>

        <script type="text/javascript">
        	var device='desktop';
            var InfoQConstants = {};
            InfoQConstants.language = 'en';
            InfoQConstants.countryCode = '';

            InfoQConstants.pageUrl = (typeof window.location != 'undefined' && window.location && typeof window.location.href != 'undefined' && window.location.href) ? window.location.href : "URL_UNAVAILABLE";
            InfoQConstants.cet='3RaMYycgxx3pVLNX';
            InfoQConstants.userDetectedCountryCode = 'CN';
            InfoQConstants.bpadb = 'PigR2RjM1IL3h6ZtNGof';
        </script>

        <script type="text/javascript" src="https://cdn.infoq.com/statics_s2_20240917061620/scripts/combinedJs.min.js"></script>
        <script type="text/javascript">

                var JSi18n = JSi18n || {}; // define only if not already defined
                JSi18n.error='Error';
                JSi18n.login_unverifiedAccount='Unverified account';
                JSi18n.contentSummary_showPresentations_1='';
                JSi18n.contentSummary_showPresentations_2='';
                JSi18n.contentSummary_showPresentations_3='';
                JSi18n.contentSummary_showInterviews_1='';
                JSi18n.contentSummary_showInterviews_2='';
                JSi18n.contentSummary_showInterviews_3='';
                JSi18n.contentSummary_showMinibooks_1='';
                JSi18n.contentSummary_showMinibooks_2='';
                JSi18n.login_sendingRequest='Sending request ...';
                JSi18n.bookmark_saved='<q>&nbsp;&nbsp;&nbsp;Saved&nbsp;&nbsp;&nbsp;&nbsp;</q>';
                JSi18n.bookmark_error='<q style=color:black;>&nbsp;&nbsp;&nbsp;Error&nbsp;&nbsp;&nbsp;&nbsp;</q>';
                JSi18n.categoryManagement_showpopup_viewAllLink_viewAllPrefix='View All';
                JSi18n.categoryManagement_showpopup_viewAllLink_viewAllSuffix='';
                JSi18n.categoryManagement_showpopup_includeExcludeLink_Exclude='Exclude';
                JSi18n.categoryManagement_showpopup_includeExcludeLink_Include='Include';
                JSi18n.login_invalid_email='Please specify a valid email';
                JSi18n.login_email_not_found = 'No user found with that email';
                JSi18n.content_datetime_format='MMM dd, yyyy';

                // used by frontend
                JSi18n.FE = {
                    labels: {
                        follow: "Follow",
                        followTopic: "Follow Topic",
                        unfollow: "Unfollow",
                        unfollowTopic: "Unfollow Topic",
                        following: "Following",
                        followers: "Followers",
                        like: "Like",
                        liked: "Liked",
                        authors: "Peers",
                        users : "Users",
                        topics: "Topics",
                        hide: "Hide Item",
                        hidden: "%s was hidden on your profile page.",
                        undo: "Undo",
                        showLess: "Show less",
                        showMore: "Show more",
                        moreAuthors: "And %s more",
                        bookmarked: "Content Bookmarked",
                        unbookmarked: "Content Unbookmarked",
                        characterLimit: "Characters Remaining"
                    }
                }





                var usersInPage = JSON.parse('[{\"id\":\"62671158\",\"ref\":\"author-Monica-Beckwith\",\"url\":\"\/profile\/Monica-Beckwith\",\"followedByCurrentUser\":false,\"minibio\":\"\",\"name\":\"Monica Beckwith\",\"bio\":\"Java Champion, Monica Beckwith is a Java performance engineer. She currently works on improving OpenJDK&#39;s HotSpot VM at Microsoft. Her past experiences include working with Arm, Oracle\/Sun and AMD; optimizing the JVM for server class systems. Monica was voted a JavaOne Rock Star speaker and was the performance lead for Garbage First Garbage Collector (G1 GC). You can follow Monica on twitter &#64;mon_beck\",\"followers\":1688,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/QhDv7pXEUK1sdLsYArFmnLxecH4rYhAc.jpg\"},{\"id\":\"45723890\",\"ref\":\"author-Rags-Srinivas\",\"url\":\"\/profile\/Rags-Srinivas\",\"followedByCurrentUser\":false,\"minibio\":\"\",\"name\":\"Rags Srinivas\",\"bio\":\"Raghavan &#34;Rags&#34; Srinivas (&#64;ragss) works as an Architect\/Developer Evangelist goaled with helping developers build highly scalable and available systems. As an OpenStack advocate and solutions architect at Rackspace he was constantly challenged from low level infrastructure to high level application issues. His general focus area is in distributed systems, with a specialization in Cloud Computing and Big Data. He worked on Hadoop, HBase and NoSQL during its early stages. He has spoken on a variety of technical topics at conferences around the world, written for developer portals, conducted and organized Hands-on Labs and taught graduate and online classes in the evening. Rags brings with him over 25 years of hands-on software development and over 15 years of architecture and technology evangelism experience. He has evangelized and influenced the architecture of a number of emerging technology areas. He is also a repeat JavaOne rock star speaker award winner. Rags holds a Masters degree in Computer Science from the Center of Advanced Computer Studies at the University of Louisiana at Lafayette. He likes to hike, run and generally be outdoors but most of all loves to eat.\",\"followers\":245,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/t4nyfgw1THkp4wMZ9EZ59RGJx8Hf9Rk8.jpg\"},{\"id\":\"126464202\",\"ref\":\"author-Johan-Janssen\",\"url\":\"\/profile\/Johan-Janssen\",\"followedByCurrentUser\":false,\"minibio\":\"Architect at ASML\",\"name\":\"Johan Janssen\",\"bio\":\"Architect at ASML, loves to share knowledge mainly around Java. Spoke at conferences such as Devoxx, Oracle Code One, Devnexus, and many more. Assisted conferences by participating in program committees and invented and organized JVMCON. Received the JavaOne Rock Star and Oracle Code One Star awards. Wrote various articles both for digital and printed media. Maintainer of various Java JDK\/JRE packages for Chocolatey with around 100 thousand downloads a month.\",\"followers\":365,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/Fb4eZ0mtvMf6MhsmBIhsUVueV4xAs2FD.jpg\"},{\"id\":\"39485652\",\"ref\":\"author-Daniel-Bryant\",\"url\":\"\/profile\/Daniel-Bryant\",\"followedByCurrentUser\":false,\"minibio\":\"InfoQ News Manager | Building Platforms at Syntasso\",\"name\":\"Daniel Bryant\",\"bio\":\"Daniel Bryant is the news manager at InfoQ and the emeritus chair of QCon London. He is also a platform engineer and head of product marketing at Syntasso. Daniel&#39;s technical expertise focuses on \u2018DevOps\u2019 tooling, cloud\/container platforms, and microservice implementations. He is a long-time coder and Java Champion who has contributed to several open source projects. Daniel also writes for InfoQ, O\u2019Reilly, and The New Stack and regularly presents at international conferences such as KubeCon, QCon, and JavaOne. In his copious amounts of free time, he enjoys running, reading, and travelling.\",\"followers\":2550,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/tSe5dczMaSGtRUm18VkTR2tcF4W3SogA.jpg\"},{\"id\":\"63268344\",\"ref\":\"author-Chris-Swan\",\"url\":\"\/profile\/Chris-Swan\",\"followedByCurrentUser\":false,\"minibio\":\"Engineer, Atsign\",\"name\":\"Chris Swan\",\"bio\":\"Chris Swan is an Engineer at <a href=\\\"https:\/\/atsign.com\\\" rel=\\\"nofollow\\\">Atsign<\/a>, building the atPlatform, a technology that is putting people in control of their data and removing the frictions and surveillance associated with today\u2019s Internet. He was previously a Fellow at DXC Technology where he held various CTO roles. Before that he held CTO and Director of R&amp;D roles at Cohesive Networks, UBS, Capital SCF and Credit Suisse, where he worked on app servers, compute grids, security, mobile, cloud, networking and containers. Chris co-hosts the <a href=\\\"https:\/\/techdebtburndown.com\/\\\" rel=\\\"nofollow\\\">Tech Debt Burndown Podcast<\/a> and is a Dart Google Developer Expert (<a href=\\\"https:\/\/developers.google.com\/community\/experts\\\" rel=\\\"nofollow\\\">GDE<\/a>).\",\"followers\":1740,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/8PE76nOujWAoCM8yqLn9Hfv2HqW3VlIP.jpg\"},{\"id\":\"4927376\",\"ref\":\"author-Karsten-Silz\",\"url\":\"\/profile\/Karsten-Silz\",\"followedByCurrentUser\":false,\"minibio\":\"Full-Stack Java Developer &amp; Contractor\",\"name\":\"Karsten Silz\",\"bio\":\"Karsten Silz has worked as a full-stack Java developer (Spring Boot, Angular, Flutter) for 25 years in Europe and the US. In 2004, he co-founded a software product start-up in the US. Karsten led product development for 13 years and left after the company was sold successfully. Since 2003, he has also worked as a contractor. He co-founded the SaaS start-up &#34;Your Home in Good Hands&#34; as CTO in the UK in 2020.\",\"followers\":278,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/p6zmOdOcqXiRj09iiZNeDZap7f0IglQW.jpg\"},{\"id\":\"87551248\",\"ref\":\"author-Steef~Jan-Wiggers\",\"url\":\"\/profile\/Steef~Jan-Wiggers\",\"followedByCurrentUser\":false,\"minibio\":\"Cloud Queue Lead Editor\",\"name\":\"Steef-Jan Wiggers\",\"bio\":\"Steef-Jan Wiggers is one of InfoQ&#39;s senior cloud editors and works as an Integration Architect at i8c in The Netherlands. His current technical expertise focuses on integration platform implementations, Azure DevOps, and Azure Platform Solution Architectures. Steef-Jan is a regular speaker at conferences and user groups and writes for InfoQ. Furthermore, Microsoft has recognized him as Microsoft Azure MVP for the past fourteen years.\",\"followers\":649,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/BhZx03k3Hj0pZVXmTzGqItwZxtJ06oIb.jpeg\"},{\"id\":\"343314\",\"ref\":\"author-Jonathan-Allen\",\"url\":\"\/profile\/Jonathan-Allen\",\"followedByCurrentUser\":false,\"minibio\":\"Software Architect\",\"name\":\"Jonathan Allen\",\"bio\":\"Jonathan Allen got his start working on MIS projects for a health clinic in the late 90&#39;s, bringing them up from Access and Excel to an enterprise solution by degrees. After spending five years writing automated trading systems for the financial sector, he became a consultant on a variety of projects including the UI for a robotic warehouse, the middle tier for cancer research software, and the big data needs of a major real estate insurance company. In his free time he enjoys studying and writing about martial arts from the 16th century.\\r\\n\",\"followers\":1705,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/Wk_C09_mzwK23YkTkKMXResJv3LKUN5D.jpg\"},{\"id\":\"80977916\",\"ref\":\"author-Thomas-Betts\",\"url\":\"\/profile\/Thomas-Betts\",\"followedByCurrentUser\":false,\"minibio\":\"Laureate Application Architect at Blackbaud\",\"name\":\"Thomas Betts\",\"bio\":\"Thomas Betts is the Lead Editor for Architecture and Design at InfoQ, a co-host of the InfoQ Podcast, and a Laureate Software Architect at Blackbaud.\\r\\n\\r\\nFor over two decades, his focus has always been on providing software solutions that delight his customers. He has worked in a variety of industries, including social good, retail, finance, health care, defense and travel.\\r\\n\\r\\nThomas lives in Denver with his wife and son, and they love hiking and otherwise exploring beautiful Colorado.\",\"followers\":922,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/pSqI6HrU3k9rmmVjwS34OHG0bOMYiE6a.jpg\"},{\"id\":\"126467140\",\"ref\":\"author-Renato-Losio\",\"url\":\"\/profile\/Renato-Losio\",\"followedByCurrentUser\":false,\"minibio\":\"InfoQ Staff Editor | Cloud Expert | AWS Data Hero  \",\"name\":\"Renato Losio\",\"bio\":\"Renato has extensive experience as a cloud architect, tech lead, and cloud services specialist. Currently, he lives between Berlin and Trieste and works remotely as a principal cloud architect. His primary areas of interest include cloud services and relational databases. He is an editor at InfoQ and a recognized AWS Data Hero. You can connect with him on LinkedIn.\",\"followers\":573,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/ptroF8HdI2vWXm0NDaKeS0JdiPxMOAra.jpg\"},{\"id\":\"72028228\",\"ref\":\"author-Sergio-De-Simone\",\"url\":\"\/profile\/Sergio-De-Simone\",\"followedByCurrentUser\":false,\"minibio\":\"\",\"name\":\"Sergio De Simone\",\"bio\":\"<b>Sergio De Simone<\/b> is a software engineer. Sergio has been working as a software engineer for over twenty five years across a range of different projects and companies, including such different work environments as Siemens, HP, and small startups. For the last 10&#43; years, his focus has been on development for mobile platforms and related technologies. He is currently working for BigML, Inc., where he leads iOS and macOS development.\",\"followers\":584,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/NovciOoQOAYWqYqRQBFo97SuMm0xbUiC.jpg\"},{\"id\":\"114725059\",\"ref\":\"author-Holly-Cummins\",\"url\":\"\/profile\/Holly-Cummins\",\"followedByCurrentUser\":false,\"minibio\":\"Senior Principal Software Engineer, Red Hat\",\"name\":\"Holly Cummins\",\"bio\":\"Holly Cummins is a Senior Principal Software Engineer on the Red Hat Quarkus team. Before joining Red Hat, Holly was a long time IBMer. In her time at IBM, Holly has been a full-stack javascript developer, a WebSphere Liberty build architect, a client-facing consultant, a JVM performance engineer, and an innovation leader. During her time in the IBM Garage, Holly led projects for enormous banks, tiny startups, and everything in between. Holly has used the power of cloud to understand climate risks, count fish, help a blind athlete run ultra-marathons in the desert solo, and invent stories (although not at all the same time). Holly is also a Java Champion, author, and regular keynote speaker. You can follow her on twitter at &#64;holly_cummins or at hollycummins.com.\\r\\n\\r\\n\\r\\nBefore joining IBM, Holly completed a PhD in Quantum Computation.\\r\\n\",\"followers\":427,\"imgSrc\":\"https:\/\/cdn.infoq.com\/statics_s2_20240917061620\/images\/profiles\/cRsuGlFgKyGmGfEHvafpMO63CxbrEm22.jpg\"}]');




                var topicsInPage = JSON.parse('[{\"name\":\"Architecture & Design\",\"id\":\"6816\",\"followers\":9236,\"url\":\"\/architecture-design\",\"followedByCurrentUser\":false},{\"name\":\"Culture & Methods\",\"id\":\"6817\",\"followers\":3616,\"url\":\"\/culture-methods\",\"followedByCurrentUser\":false},{\"name\":\".NET Core\",\"id\":\"15683\",\"followers\":7125,\"url\":\"\/Net-Core\",\"followedByCurrentUser\":false},{\"name\":\"React\",\"id\":\"15624\",\"followers\":227,\"url\":\"\/React\",\"followedByCurrentUser\":false},{\"name\":\"Machine Learning\",\"id\":\"5449\",\"followers\":13034,\"url\":\"\/MachineLearning\",\"followedByCurrentUser\":false},{\"name\":\"Microservices\",\"id\":\"15274\",\"followers\":20198,\"url\":\"\/microservices\",\"followedByCurrentUser\":false},{\"name\":\"S3\",\"id\":\"3601\",\"followers\":10,\"url\":\"\/S3\",\"followedByCurrentUser\":false},{\"name\":\"AI, ML & Data Engineering\",\"id\":\"16690\",\"followers\":4912,\"url\":\"\/ai-ml-data-eng\",\"followedByCurrentUser\":false},{\"name\":\"AWS\",\"id\":\"3737\",\"followers\":304,\"url\":\"\/AWS\",\"followedByCurrentUser\":false},{\"name\":\"Java9\",\"id\":\"7097\",\"followers\":4865,\"url\":\"\/Java9\",\"followedByCurrentUser\":false},{\"name\":\"Cloud\",\"id\":\"7451\",\"followers\":1913,\"url\":\"\/Cloud\",\"followedByCurrentUser\":false},{\"name\":\"DevOps\",\"id\":\"6043\",\"followers\":4599,\"url\":\"\/Devops\",\"followedByCurrentUser\":false},{\"name\":\"Reactive Programming\",\"id\":\"15453\",\"followers\":11317,\"url\":\"\/reactive-programming\",\"followedByCurrentUser\":false},{\"name\":\"Development\",\"id\":\"6815\",\"followers\":3690,\"url\":\"\/development\",\"followedByCurrentUser\":false}]');


            var userContentLikesInPage = [];
            var userCommentsLikesInPage = [];


            var currentUserId = 48777322;
        </script>

        	<script type="text/javascript">
        		// set this if logged in if not this will be set when login (see loginAction.jsp)
        		InfoQConstants.isUserBlocked=false;
        		InfoQConstants.isUserOutdated=false;
        		InfoQConstants.loggedUserEmail='wiloon.wy@gmail.com';
                InfoQConstants.editorUser = 'false';
                InfoQConstants.chiefEditor ='false';

                // needed by frontend in multiple parts especially related to profile (interests, profile ...)
                InfoQConstants.userToken = '28NnWBwZ7vsg2gW2hUxPTxIMJ6lywqCE';

                // used by frontend to know how to display or not the follow button on profile page. (stays in decorator to avoid pagecache)
                InfoQConstants.isFollowedByCurrentUser = false;
        	</script>




















<script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "NewsArticle",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/"
    },
  "headline": "Amazon Introduces Storage Browser for S3",
  "image": ["https://res.infoq.com/news/2024/09/amazon-storage-browser-s3/en/headerimage/generatedHeaderImage-1726147307725.jpg"
   ],
  "datePublished": "2024-09-14",
  "dateModified": "2024-09-14",
  "author": [
    {
    "@type": "Person",
    "name": "Renato Losio"
    }
  ],
   "publisher": {
    "@type": "Organization",
    "name": "InfoQ",
    "logo": {
      "@type": "ImageObject",
      "url": "https://assets.infoq.com/resources/en/infoQ-logo-big.jpg"
    }
  },

  "description": "Amazon has recently announced the alpha release of Storage Browser for Amazon S3, providing end users with a simple interface for accessing data stored in S3. The project is available in the AWS Ampli"
}
</script>

	<meta name="ifq:pageType" content="NEWS_PAGE"/>
	<script type="text/javascript">
		InfoQConstants.pageType = 'NEWS_PAGE';
	</script>


		<link rel="stylesheet" href="https://cdn.infoq.com/statics_s2_20240917061620/styles/prism.css"/>
		<meta name="keywords" content="amazon storage browser s3,Development,Architecture &amp; Design,AWS,React,S3,Cloud,"/>
		<meta name="description" content="Amazon has recently announced the alpha release of Storage Browser for Amazon S3, providing end users with a simple interface for accessing data stored in S3. The project is available in the AWS Ampli"/>
		<meta name="tprox" content="1726294620000" />









<meta property="og:type" content="website" />











        <meta property="og:image" content="https://res.infoq.com/news/2024/09/amazon-storage-browser-s3/en/headerimage/generatedHeaderImage-1726147307725.jpg"/>









        <meta property="twitter:image" content="https://res.infoq.com/news/2024/09/amazon-storage-browser-s3/en/card_header_image/generatedCard-1726147307725.jpg"/>








<meta property="og:title" content="Amazon Introduces Storage Browser for S3 "/>
<meta property="og:description" content="Amazon has recently announced the alpha release of Storage Browser for Amazon S3, providing end users with a simple interface for accessing data stored in S3. The project is available in the AWS Amplify JavaScript and React client libraries." />
<meta property="og:site_name" content="InfoQ"/>
<meta property="og:url" content="https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/"/>

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Amazon Introduces Storage Browser for S3 "/>
<meta name="twitter:description" content="Amazon has recently announced the alpha release of Storage Browser for Amazon S3, providing end users with a simple interface for accessing data stored in S3. The project is available in the AWS Amplify JavaScript and React client libraries." />


			<link rel="image_src" href="https://res.infoq.com/news/2024/09/amazon-storage-browser-s3/en/headerimage/generatedHeaderImage-1726147307725.jpg"/>




	<script type="text/javascript" src="https://cdn.infoq.com/statics_s2_20240917061620/scripts/relatedVcr.min.js"></script>
	<script type="application/javascript">
		var communityIds = "2497,2498";
		var topicIds = "1024,4278,951,2961";
		VCR.loadAllVcrs(communityIds, topicIds);
	</script>




        <script type="text/javascript" src="https://cdn.infoq.com/statics_s2_20240917061620/scripts/infoq.js"></script>

        <script type="text/javascript">
           document.addEventListener('DOMContentLoaded', function() {
               if (!window || !window.infoq) return
               infoq.init()
           })
       </script>

    </head>

    <body >







<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-W9GJ5DL"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->

            <div class="intbt">
                <a href="/int/bt/" title="bt">BT</a>
            </div>









<script type="text/javascript">
    var allCountries = [{"id":3,"name":"Afghanistan"},{"id":244,"name":"Åland"},{"id":6,"name":"Albania"},{"id":61,"name":"Algeria"},{"id":13,"name":"American Samoa"},{"id":1,"name":"Andorra"},{"id":9,"name":"Angola"},{"id":5,"name":"Anguilla"},{"id":11,"name":"Antarctica"},{"id":4,"name":"Antigua and Barbuda"},{"id":12,"name":"Argentina"},{"id":7,"name":"Armenia"},{"id":16,"name":"Aruba"},{"id":15,"name":"Australia"},{"id":14,"name":"Austria"},{"id":17,"name":"Azerbaijan"},{"id":31,"name":"Bahamas"},{"id":24,"name":"Bahrain"},{"id":20,"name":"Bangladesh"},{"id":19,"name":"Barbados"},{"id":35,"name":"Belarus"},{"id":21,"name":"Belgium"},{"id":36,"name":"Belize"},{"id":26,"name":"Benin"},{"id":27,"name":"Bermuda"},{"id":32,"name":"Bhutan"},{"id":29,"name":"Bolivia"},{"id":254,"name":"Bonaire, Sint Eustatius, and Saba"},{"id":18,"name":"Bosnia and Herzegovina"},{"id":34,"name":"Botswana"},{"id":33,"name":"Bouvet Island"},{"id":30,"name":"Brazil"},{"id":104,"name":"British Indian Ocean Territory"},{"id":28,"name":"Brunei Darussalam"},{"id":23,"name":"Bulgaria"},{"id":22,"name":"Burkina Faso"},{"id":25,"name":"Burundi"},{"id":114,"name":"Cambodia"},{"id":46,"name":"Cameroon"},{"id":37,"name":"Canada"},{"id":52,"name":"Cape Verde"},{"id":121,"name":"Cayman Islands"},{"id":40,"name":"Central African Republic"},{"id":207,"name":"Chad"},{"id":45,"name":"Chile"},{"id":47,"name":"China"},{"id":53,"name":"Christmas Island"},{"id":38,"name":"Cocos (Keeling) Islands"},{"id":48,"name":"Colombia"},{"id":116,"name":"Comoros"},{"id":39,"name":"Congo (Democratic Republic)"},{"id":41,"name":"Congo (People\u0027s Republic)"},{"id":44,"name":"Cook Islands"},{"id":49,"name":"Costa Rica"},{"id":43,"name":"Cote D\u0027Ivoire"},{"id":97,"name":"Croatia"},{"id":51,"name":"Cuba"},{"id":253,"name":"Curaçao"},{"id":54,"name":"Cyprus"},{"id":55,"name":"Czech Republic"},{"id":58,"name":"Denmark"},{"id":57,"name":"Djibouti"},{"id":59,"name":"Dominica"},{"id":60,"name":"Dominican Republic"},{"id":213,"name":"East Timor"},{"id":62,"name":"Ecuador"},{"id":64,"name":"Egypt"},{"id":203,"name":"El Salvador"},{"id":87,"name":"Equatorial Guinea"},{"id":66,"name":"Eritrea"},{"id":63,"name":"Estonia"},{"id":68,"name":"Ethiopia"},{"id":72,"name":"Falkland Islands (Malvinas)"},{"id":74,"name":"Faroe Islands"},{"id":71,"name":"Fiji"},{"id":70,"name":"Finland"},{"id":75,"name":"France"},{"id":80,"name":"French Guiana"},{"id":170,"name":"French Polynesia"},{"id":208,"name":"French Southern Territories"},{"id":76,"name":"Gabon"},{"id":84,"name":"Gambia"},{"id":79,"name":"Georgia"},{"id":56,"name":"Germany"},{"id":81,"name":"Ghana"},{"id":82,"name":"Gibraltar"},{"id":88,"name":"Greece"},{"id":83,"name":"Greenland"},{"id":78,"name":"Grenada"},{"id":86,"name":"Guadeloupe"},{"id":91,"name":"Guam"},{"id":90,"name":"Guatemala"},{"id":249,"name":"Guernsey"},{"id":85,"name":"Guinea"},{"id":92,"name":"Guinea-Bissau"},{"id":93,"name":"Guyana"},{"id":98,"name":"Haiti"},{"id":95,"name":"Heard Island and McDonald Islands"},{"id":96,"name":"Honduras"},{"id":94,"name":"Hong Kong"},{"id":99,"name":"Hungary"},{"id":107,"name":"Iceland"},{"id":103,"name":"India"},{"id":100,"name":"Indonesia"},{"id":106,"name":"Iran"},{"id":105,"name":"Iraq"},{"id":101,"name":"Ireland"},{"id":245,"name":"Isle of Man"},{"id":102,"name":"Israel"},{"id":108,"name":"Italy"},{"id":109,"name":"Jamaica"},{"id":111,"name":"Japan"},{"id":250,"name":"Jersey"},{"id":110,"name":"Jordan"},{"id":122,"name":"Kazakhstan"},{"id":112,"name":"Kenya"},{"id":115,"name":"Kiribati"},{"id":243,"name":"Kosovo"},{"id":120,"name":"Kuwait"},{"id":113,"name":"Kyrgyzstan"},{"id":123,"name":"Laos"},{"id":132,"name":"Latvia"},{"id":124,"name":"Lebanon"},{"id":129,"name":"Lesotho"},{"id":128,"name":"Liberia"},{"id":133,"name":"Libya"},{"id":126,"name":"Liechtenstein"},{"id":130,"name":"Lithuania"},{"id":131,"name":"Luxembourg"},{"id":143,"name":"Macau"},{"id":139,"name":"Macedonia"},{"id":137,"name":"Madagascar"},{"id":151,"name":"Malawi"},{"id":153,"name":"Malaysia"},{"id":150,"name":"Maldives"},{"id":140,"name":"Mali"},{"id":148,"name":"Malta"},{"id":138,"name":"Marshall Islands"},{"id":145,"name":"Martinique"},{"id":146,"name":"Mauritania"},{"id":149,"name":"Mauritius"},{"id":238,"name":"Mayotte"},{"id":152,"name":"Mexico"},{"id":73,"name":"Micronesia"},{"id":136,"name":"Moldova"},{"id":135,"name":"Monaco"},{"id":142,"name":"Mongolia"},{"id":246,"name":"Montenegro"},{"id":147,"name":"Montserrat"},{"id":134,"name":"Morocco"},{"id":154,"name":"Mozambique"},{"id":141,"name":"Myanmar"},{"id":155,"name":"Namibia"},{"id":164,"name":"Nauru"},{"id":163,"name":"Nepal"},{"id":161,"name":"Netherlands"},{"id":8,"name":"Netherlands Antilles"},{"id":156,"name":"New Caledonia"},{"id":166,"name":"New Zealand"},{"id":160,"name":"Nicaragua"},{"id":157,"name":"Niger"},{"id":159,"name":"Nigeria"},{"id":165,"name":"Niue"},{"id":158,"name":"Norfolk Island"},{"id":118,"name":"North Korea"},{"id":144,"name":"Northern Mariana Islands"},{"id":162,"name":"Norway"},{"id":167,"name":"Oman"},{"id":173,"name":"Pakistan"},{"id":180,"name":"Palau"},{"id":178,"name":"Palestinian Territory"},{"id":168,"name":"Panama"},{"id":171,"name":"Papua New Guinea"},{"id":181,"name":"Paraguay"},{"id":169,"name":"Peru"},{"id":172,"name":"Philippines"},{"id":176,"name":"Pitcairn"},{"id":174,"name":"Poland"},{"id":179,"name":"Portugal"},{"id":177,"name":"Puerto Rico"},{"id":182,"name":"Qatar"},{"id":183,"name":"Reunion"},{"id":184,"name":"Romania"},{"id":185,"name":"Russian Federation"},{"id":186,"name":"Rwanda"},{"id":193,"name":"Saint Helena"},{"id":117,"name":"Saint Kitts and Nevis"},{"id":125,"name":"Saint Lucia"},{"id":251,"name":"Saint Martin"},{"id":175,"name":"Saint Pierre and Miquelon"},{"id":229,"name":"Saint Vincent and the Grenadines"},{"id":247,"name":"Saint-Barthélemy"},{"id":236,"name":"Samoa"},{"id":198,"name":"San Marino"},{"id":202,"name":"Sao Tome and Principe"},{"id":187,"name":"Saudi Arabia"},{"id":199,"name":"Senegal"},{"id":248,"name":"Serbia"},{"id":189,"name":"Seychelles"},{"id":197,"name":"Sierra Leone"},{"id":192,"name":"Singapore"},{"id":252,"name":"Sint Maarten"},{"id":196,"name":"Slovakia"},{"id":194,"name":"Slovenia"},{"id":188,"name":"Solomon Islands"},{"id":200,"name":"Somalia"},{"id":239,"name":"South Africa"},{"id":89,"name":"South Georgia and the South Sandwich Islands"},{"id":119,"name":"South Korea"},{"id":255,"name":"South Sudan"},{"id":67,"name":"Spain"},{"id":127,"name":"Sri Lanka"},{"id":190,"name":"Sudan"},{"id":201,"name":"Suriname"},{"id":195,"name":"Svalbard and Jan Mayen"},{"id":205,"name":"Swaziland"},{"id":191,"name":"Sweden"},{"id":42,"name":"Switzerland"},{"id":204,"name":"Syria"},{"id":220,"name":"Taiwan"},{"id":211,"name":"Tajikistan"},{"id":221,"name":"Tanzania"},{"id":210,"name":"Thailand"},{"id":209,"name":"Togo"},{"id":212,"name":"Tokelau"},{"id":216,"name":"Tonga"},{"id":218,"name":"Trinidad and Tobago"},{"id":215,"name":"Tunisia"},{"id":217,"name":"Turkey"},{"id":214,"name":"Turkmenistan"},{"id":206,"name":"Turks and Caicos Islands"},{"id":219,"name":"Tuvalu"},{"id":223,"name":"Uganda"},{"id":222,"name":"Ukraine"},{"id":2,"name":"United Arab Emirates"},{"id":77,"name":"United Kingdom"},{"id":224,"name":"United States Minor Outlying Islands"},{"id":226,"name":"Uruguay"},{"id":225,"name":"USA"},{"id":227,"name":"Uzbekistan"},{"id":234,"name":"Vanuatu"},{"id":228,"name":"Vatican City (Holy See)"},{"id":230,"name":"Venezuela"},{"id":233,"name":"Vietnam"},{"id":231,"name":"Virgin Islands (British)"},{"id":232,"name":"Virgin Islands (U.S.)"},{"id":235,"name":"Wallis and Futuna"},{"id":65,"name":"Western Sahara"},{"id":237,"name":"Yemen"},{"id":241,"name":"Zaire"},{"id":240,"name":"Zambia"},{"id":242,"name":"Zimbabwe"}];
    var gdprCountriesIds = [196,194,191,184,179,174,161,148,132,131,130,108,101,99,97,88,77,75,70,67,63,58,56,55,54,37,23,21,14];
</script>









    <section data-nosnippet class="section container subscribe-box hidden">
        <div class="container__inner">
            <div class="actions">
                <div class="actions__left">
                    <h2>InfoQ Software Architects' Newsletter</h2>
                    <span><p>A monthly overview of things you need to know as an architect or aspiring architect.</p>

<p><a href="https://www.infoq.com/software-architects-newsletter#placeholderPastIssues">View an example</a></p>
</span>
                    <div class="newsletter__subscribe">
                        <form class="form gdpr" name="dataCollectCampaignNewsletterForm" id="dataCollectCampaignNewsletterForm" action="#" onsubmit="dataCollectNewsletter.saveSubscription(); return false;">
                            <div class="field newsletter__mail input__text input__no-label input__medium email">
                                <label for="email-dataCollectnewsletter-infoq" class="label field__label">Enter your e-mail address</label>
                                <input id="email-dataCollectnewsletter-infoq" name="footerNewsletterEmail" placeholder="Enter your e-mail address" class="input field__input" type="text"/>
                                <input type="text" name="emailH" id="input_email_h_d" aria-required="false" style="display:none !important" tabindex="-1" autocomplete="off"/>
                                <input type="hidden" id="fnt_d" name="fnt_d" value="3RaMYycgxx3pVLNX"/>
                                <input type="hidden" id="dataCollectNewsletterType" name="dataCollectNewsletterType" value="regular"/>
                                <input type="hidden" id="cmpi_d" name="cmpi_d" value="4"/>
                            </div>
                            <div class="hidden">
                    <span aria-required="false" class="input__select field country">
                        <label for="input-dataCollect-newsletter-country" class="label field__label">Select your country</label>
                        <select id="input-dataCollect-newsletter-country" class="select field__input">
                            <option value="" class="select__option">Select a country</option>
                        </select>
                        <p class="input__message field__desc"></p>
                    </span>
                                <span class="input__checkbox field hidden">
                        <input type="checkbox" id="gdpr-consent-campaign">
                        <label for="gdpr-consent-campaign" class="label"><span>I consent to InfoQ.com handling my data as explained in this <a href="https://www.infoq.com/privacy-notice">Privacy Notice</a>.</span></label>
                    </span>
                            </div>
                            <input type="submit" value="Subscribe" class="button button__medium button__red" onclick="return dataCollectNewsletter.validateEmail('Invalid email address');"/>
                        </form>
                        <p class="meta">
                            <a href="/privacy-notice/" target="_blank">We protect your privacy.</a>
                        </p>

                        <span class="success" style="display:none;" id="dataCollectNewsletterMessage"></span>
                    </div>

                </div>
                <div class="actions__right">
                    <button aria-label="Close" class="close closeBox button button__unstyled button__icon icon icon__close-black icon--only">Close</button>
                </div>
            </div>
        </div>
    </section>
    <script type="text/javascript">
        var dataCollectNewsletter = new Newsletter('Enter your e-mail address',
                'email-dataCollectnewsletter-infoq', 'dataCollectNewsletterType','dataCollectNewsletterMessage', 'fnt_d', 'input_email_h_d', 'input-dataCollect-newsletter-country', 'cmpi_d','popup_all_pages');
    </script>














        <div class="infoq" id="infoq">

                <!--	#######		SITE START	#########	 -->




















    <section class="section container promo hidden">
        <div class="container__inner">
            <div class="actions">
                <div class="actions__left">
                    <p>
                        <span>Live Webinar and Q&amp;A: The Architect’s Guide to Elasticity (Sept 26, 2024)</span>
                        <a class="btn" href="/url/pb/542db33f-6be6-4361-94fa-6ae49f593e12/" target="_blank" rel="nofollow">
                            Save Your Seat
                        </a>
                    </p>
                </div>
                <div class="actions__right">
                    <button aria-label="Close"
                            class="close button button__unstyled button__icon icon icon__close-white icon--only close-top-promo">Close
                    </button>
                </div>
            </div>
        </div>
    </section>





<header class="header">
    <button aria-label="Toggle Navigation" tabindex="0" class="burger header__toggle button">Toggle Navigation <span></span><span></span><span></span></button>
    <div class="header__container container">
        <div class="container__inner">
            <div data-nosnippet class="actions header__top">
                <div class="actions__left">
                    <p class="header__desc my-0">
                        Facilitating the Spread of Knowledge and Innovation in Professional Software Development
                    </p>
                    <div class="button__dropdown dropdown header__more my-0 dropdown__center">








<button aria-label="English edition" class="button button__unstyled button__small">English edition </button>
<div class="dropdown__holder">
	<!---->
	<div class="dropdown__content">
		<ul class="no-style dropdown__nav languagesEdition">
			<li class="active"><a href="#" onclick="return false;">English edition</a></li>
			<li><a href="https://www.infoq.cn">Chinese edition</a></li>
			<li><a href="/jp/">Japanese edition</a></li>
			<li><a href="/fr/">French edition</a></li>
		</ul>
	</div>
	<!---->
</div>
                    </div>
                    <a class="my-0 contribute-link" role="button" href="/write-for-infoq/" title="Write for InfoQ">
                        Write for InfoQ
                    </a>
                </div>
                <div class="actions__right">
                    <div>
                        <form id="searchForm" name="search-form" action="/search.action" enctype="multipart/form-data" class="search icon__search icon icon__green">
                            <div class="field search__bar input__text input__no-label input__small">
                                <label for="search" class="label field__label">Search</label>
                                <input name="queryString" type="text" id="search" value="" placeholder="Search" class="input field__input">
                                <input type="hidden" name="page" value="1"/>
                                <input type="hidden" size="15" name="searchOrder">
                            </div>
                            <input value="Search" type="submit" class="search__go">
                        </form>
                    </div>








	<div class="button__dropdown dropdown user__login">
		<button aria-label="Wiloon" class="button button__small button__green button__arrow arrow__true button__icon icon icon__user icon--only">Wiloon</button>
		<div class="dropdown__holder">
			<div class="dropdown__content">
				<div class="login__dropdown">
					<div class="user__menu">
						<h4 class="user__welcome">Welcome <span class="user__name"></span></h4>
						<ul class="user__actions no-style dropdown__nav">
							<li><a href="/profile/Wiloon-Wang.1/">Profile</a></li>
							<li><a href="/edituser.action?settings=Account">Settings</a></li>
							<li><a href="/showbookmarks.action">Bookmarks</a></li>
							<li class="separator separator__line"></li>
							<li><a href="/interests/topics/">Topics You Follow</a></li>
							<li><a href="/interests/peers/">Peers You Follow</a></li>
							<li><a href="/interests/picks/">Editors' Picks</a></li>

								<li class="separator separator__line"></li>
								<li><a href="https://docs.google.com/forms/d/e/1FAIpQLSfTRlV1RStYr7_gwhxq0LNQYRfXW_TVNzrdX3m21g5p_OlBag/viewform" class="relative" target="_blank">Write for InfoQ <span class="nav__new">New</span></a></li>

						</ul>
						<a href="/logout.action" title="Sign out" class="button button__gray">Sign out</a>
					</div>
				</div>
			</div>
		</div>
	</div>



















<div class="button__dropdown dropdown user__notifications">
    <button aria-label="Notifications" class="button button__small button__green button__icon icon icon__notifications icon--only">Notifications
        <div class="badge">
            <span class="notifications__badge">1</span>
        </div>
    </button>
    <div class="dropdown__holder">
        <div class="dropdown__header">
            <div class="heading__container actions notifications__header">
                <div class="actions__left">
                    <h5 class="heading">Welcome, Wiloon Wang</h5>
                    <p>To get you started with what InfoQ has to offer, we recommend you follow:</p>
                </div>
            </div>
        </div>
        <div class="dropdown__content">
            <div class="picks" data-trk-ref="welcome_picks"></div>
        </div>
        <div class="dropdown__footer">
            <button aria-label="Dismiss" class="notifications__footer button button__unstyled button__medium" onclick="javascript:CookieManager.createCookie('P13NWN', 'closed',15552000000);location.reload();return true;">Dismiss</button>
        </div>
    </div>
</div>




<script type="text/javascript">

    UserActions_Notifications.populateAgoTimes('ul.f_notificationWidget li');
</script>

                </div>
            </div>
            <div class="header__middle">
                <div class="logo header__logo">
                    <a href="/"  class="logo__symbol active">
                        Logo - Back to homepage
                    </a>
                </div>

                <div class="content-items">
                    <a href="/news/" class="icon icon__news">News</a>
                    <a href="/articles/" class="icon icon__articles">Articles</a>
                    <a href="/presentations/" class="icon icon__presentations">Presentations</a>
                    <a href="/podcasts/" class="icon icon__podcasts">Podcasts</a>
                    <a href="/minibooks/" class="icon icon__guides">Guides</a>
                </div>
                <div class="header__items columns">
















<div>
    <h3 class="widget__heading">Topics</h3>
    <nav class="nav header__nav topics" data-trk-ref="header_personas">
        <div class="has--subnav li-nav">
            <a href="/development/" title="Development" class="nav__category">Development</a>
            <div class="nav__subnav subnav">
                <ul class="subnav__categories no-style">
                    <li><a href="/java/" title="Java">Java</a></li>
                    <li><a href="/kotlin/" title="Kotlin">Kotlin</a></li>
                    <li><a href="/dotnet/" title=".Net">.Net</a></li>
                    <li><a href="/c_sharp/" title="C#">C#</a></li>
                    <li><a href="/swift/" title="Swift">Swift</a></li>
                    <li><a href="/golang/" title="Go">Go</a></li>
                    <li><a href="/rust/" title="Rust">Rust</a></li>
                    <li><a href="/javascript/" title="JavaScript">JavaScript</a></li>
                </ul>
                <div class="subnav__content" data-id="6815">










<div class="heading__container actions">
    <div class="actions__left">
        <h3 class="heading section__heading">Featured in  Development</h3>
    </div>
</div>
<ul data-size="large" data-horizontal="true" data-tax="" taxonomy="articles" class="cards no-style">
    <li>
        <div class="card__content">
            <div class="card__data">
                <h4 class="card__title">
                    <a href="/presentations/rust-efficient-software">Not Just Memory Safety: How Rust Helps Maintain Efficient Software</a>
                </h4>
                <p class="card__excerpt">Pietro Albini discusses how Rust's type system can be used to ensure correctness and ease refactorings, leveraging procedural macros to reduce code duplication, introducing parallelism, and tooling.</p>
                <div class="card__footer"></div>
            </div>

                <a href="/presentations/rust-efficient-software" class="card__header">
                    <img loading="lazy" alt="Not Just Memory Safety: How Rust Helps Maintain Efficient Software" src="https://imgopt.infoq.com/fit-in/100x100/filters:quality(80)/presentations/rust-efficient-software/en/smallimage/PietroAlbini-small-1720791618626.jpg" class="card__image"/>
                </a>

        </div>
    </li>
</ul>




<a href="/development/" class="button__more button button__large button__arrow arrow__right">All in  development</a>

                </div>
            </div>
        </div>
        <div class="has--subnav li-nav">
            <a href="/architecture-design/" title="Architecture &amp; Design" class="nav__category">Architecture &amp; Design</a>
            <div class="nav__subnav subnav">
                <ul class="subnav__categories no-style">
                    <li><a href="/architecture/" title="Architecture">Architecture</a></li>

                    <li><a href="/enterprise-architecture/" title="Enterprise Architecture">Enterprise Architecture</a></li>
                    <li><a href="/performance-scalability/" title="Scalability/Performance">Scalability/Performance</a></li>
                    <li><a href="/design/" title="Design">Design</a></li>
                    <li><a href="/Case_Study/" title="Case Studies">Case Studies</a></li>
                    <li><a href="/microservices/" title="Microservices">Microservices</a></li>
                    <li><a href="/servicemesh/" title="Service Mesh">Service Mesh</a></li>
                    <li><a href="/DesignPattern/" title="Patterns">Patterns</a></li>
                    <li><a href="/Security/" title="Security">Security</a></li>
                </ul>
                <div class="subnav__content" data-id="6816">










<div class="heading__container actions">
    <div class="actions__left">
        <h3 class="heading section__heading">Featured in  Architecture &amp; Design</h3>
    </div>
</div>
<ul data-size="large" data-horizontal="true" data-tax="" taxonomy="articles" class="cards no-style">
    <li>
        <div class="card__content">
            <div class="card__data">
                <h4 class="card__title">
                    <a href="/articles/technical-debt-your-friend">How to Make Technical Debt Your Friend</a>
                </h4>
                <p class="card__excerpt">Technical debt is a popular metaphor for communicating the long-term implications of architectural decisions and trade-offs to stakeholders. By exploiting the feedback mechanism of the Minimum Viable Architecture (MVA) approach, we have concluded that the technical debt metaphor is misleading because much of the so-called debt never needs to be, and in fact isn’t, repaid.</p>
                <div class="card__footer"></div>
            </div>

                <a href="/articles/technical-debt-your-friend" class="card__header">
                    <img loading="lazy" alt="How to Make Technical Debt Your Friend" src="https://imgopt.infoq.com/fit-in/100x100/filters:quality(80)/articles/technical-debt-your-friend/en/smallimage/how-to-make-tehnical-debt-small-logo-1725015085842.jpg" class="card__image"/>
                </a>

        </div>
    </li>
</ul>




<a href="/architecture-design/" class="button__more button button__large button__arrow arrow__right">All in  architecture-design</a>

                </div>
            </div>
        </div>
        <div class="has--subnav li-nav">
            <a href="/ai-ml-data-eng/" title="AI, ML &amp; Data Engineering" class="nav__category">AI, ML &amp; Data Engineering</a>
            <div class="nav__subnav subnav">
                <ul class="subnav__categories no-style">
                    <li><a href="/bigdata/" title="Big Data">Big Data</a></li>
                    <li><a href="/machinelearning/" title="Machine Learning">Machine Learning</a></li>
                    <li><a href="/nosql/" title="NoSQL">NoSQL</a></li>
                    <li><a href="/database/" title="Database">Database</a></li>
                    <li><a href="/data-analytics/" title="Data Analytics">Data Analytics</a></li>
                    <li><a href="/streaming/" title="Streaming">Streaming</a></li>
                </ul>
                <div class="subnav__content" data-id="16690">










<div class="heading__container actions">
    <div class="actions__left">
        <h3 class="heading section__heading">Featured in  AI, ML &amp; Data Engineering</h3>
    </div>
</div>
<ul data-size="large" data-horizontal="true" data-tax="" taxonomy="articles" class="cards no-style">
    <li>
        <div class="card__content">
            <div class="card__data">
                <h4 class="card__title">
                    <a href="/podcasts/primer-ai-for-architects">A Primer on AI for Architects with Anthony Alford</a>
                </h4>
                <p class="card__excerpt">This episode provides an overview of the real-world technologies involved in the umbrella phrase Artificial Intelligence. Anthony Alford explains just enough about machine learning, large language models, retrieval-augmented generation, and other AI terms which today’s software architects need to be able to discuss.</p>
                <div class="card__footer"></div>
            </div>

                <a href="/podcasts/primer-ai-for-architects" class="card__header">
                    <img loading="lazy" alt="A Primer on AI for Architects with Anthony Alford" src="https://imgopt.infoq.com/fit-in/100x100/filters:quality(80)/podcasts/primer-ai-for-architects/en/smallimage/InfoQ-Podcast-logo-small-1725962132902.jpg" class="card__image"/>
                </a>

        </div>
    </li>
</ul>




<a href="/ai-ml-data-eng/" class="button__more button button__large button__arrow arrow__right">All in  ai-ml-data-eng</a>

                </div>
            </div>
        </div>
        <div class="has--subnav li-nav">
            <a href="/culture-methods/" title="Culture &amp; Methods" class="nav__category">Culture &amp; Methods</a>
            <div class="nav__subnav subnav">
                <ul class="subnav__categories no-style">
                    <li><a href="/agile/" title="Agile">Agile</a></li>
                    <li><a href="/diversity/" title="Diversity">Diversity</a></li>
                    <li><a href="/leadership/" title="Leadership">Leadership</a></li>
                    <li><a href="/lean/" title="Lean/Kanban">Lean/Kanban</a></li>
                    <li><a href="/personal-growth/" title="Personal Growth">Personal Growth</a></li>
                    <li><a href="/scrum/" title="Scrum">Scrum</a></li>
                    <li><a href="/sociocracy/" title="Sociocracy">Sociocracy</a></li>
                    <li><a href="/software_craftsmanship/" title="Software Craftmanship">Software Craftmanship</a></li>
                    <li><a href="/team-collaboration/" title="Team Collaboration">Team Collaboration</a></li>
                    <li><a href="/testing/" title="Testing">Testing</a></li>
                    <li><a href="/ux/" title="UX">UX</a></li>
                </ul>
                <div class="subnav__content" data-id="6817">










<div class="heading__container actions">
    <div class="actions__left">
        <h3 class="heading section__heading">Featured in  Culture &amp; Methods</h3>
    </div>
</div>
<ul data-size="large" data-horizontal="true" data-tax="" taxonomy="articles" class="cards no-style">
    <li>
        <div class="card__content">
            <div class="card__data">
                <h4 class="card__title">
                    <a href="/podcasts/technical-health-team-culture">Engineering Excellence: Declan Whelan on Technical Health, Agile Practices, and Team Culture</a>
                </h4>
                <p class="card__excerpt">In this podcast Shane Hastie, Lead Editor for Culture &amp; Methods spoke to Declan Whelan about technical health, useful metrics, modern technical practices, code stewardship and cultural aspects of good engineering teams.</p>
                <div class="card__footer"></div>
            </div>

                <a href="/podcasts/technical-health-team-culture" class="card__header">
                    <img loading="lazy" alt="Engineering Excellence: Declan Whelan on Technical Health, Agile Practices, and Team Culture" src="https://imgopt.infoq.com/fit-in/100x100/filters:quality(80)/podcasts/technical-health-team-culture/en/smallimage/engineering-culture-podcast-logo-1725866986265.jpeg" class="card__image"/>
                </a>

        </div>
    </li>
</ul>




<a href="/culture-methods/" class="button__more button button__large button__arrow arrow__right">All in  culture-methods</a>

                </div>
            </div>
        </div>
        <div class="has--subnav li-nav">
            <a href="/devops/" class="nav__category">DevOps</a>
            <div class="nav__subnav subnav">
                <ul class="subnav__categories no-style">
                    <li><a href="/infrastructure/" title="Infrastructure">Infrastructure</a></li>
                    <li><a href="/continuous_delivery/" title="Continuous Delivery">Continuous Delivery</a></li>
                    <li><a href="/automation/" title="Automation">Automation</a></li>
                    <li><a href="/containers/" title="Containers">Containers</a></li>
                    <li><a href="/cloud-computing/" title="Cloud">Cloud</a></li>
                    <li><a href="/observability/" title="Observability">Observability</a></li>

                </ul>
                <div class="subnav__content" data-id="6043">










<div class="heading__container actions">
    <div class="actions__left">
        <h3 class="heading section__heading">Featured in  DevOps</h3>
    </div>
</div>
<ul data-size="large" data-horizontal="true" data-tax="" taxonomy="articles" class="cards no-style">
    <li>
        <div class="card__content">
            <div class="card__data">
                <h4 class="card__title">
                    <a href="/articles/analysis-optimization-change-release-process">Mastering Impact Analysis and Optimizing Change Release Processes</a>
                </h4>
                <p class="card__excerpt">Dynamic IT professional with a proven track record in optimizing production processes and analyzing outages in complex systems handling millions of TPS. The recent CrowdStrike outage highlights the importance of continuous improvement and adherence to best practices. Passionate about elevating operational excellence through strategic reviews and effective process enhancements.</p>
                <div class="card__footer"></div>
            </div>

                <a href="/articles/analysis-optimization-change-release-process" class="card__header">
                    <img loading="lazy" alt="Mastering Impact Analysis and Optimizing Change Release Processes" src="https://imgopt.infoq.com/fit-in/100x100/filters:quality(80)/articles/analysis-optimization-change-release-process/en/smallimage/Mastering-Impact-Analysis-Optimizing-Change-logo-small-1724927868071.jpg" class="card__image"/>
                </a>

        </div>
    </li>
</ul>




<a href="/devops/" class="button__more button button__large button__arrow arrow__right">All in  devops</a>

                </div>
            </div>
        </div>
        <div class="li-nav">

            <a rel="noreferrer noopener" href="https://events.infoq.com/" class="nav__category" title="Events" target="_blank">Events</a>
        </div>
    </nav>
</div>

<div>
    <h3 class="widget__heading">Helpful links</h3>
    <ul class="no-style header__nav">
       <li>
            <a href="/about-infoq" title="About InfoQ">
                About InfoQ
            </a>
        </li>
        <li>
            <a href="/infoq-editors" title="InfoQ Editors">
                InfoQ Editors
            </a>
        </li>
        <li>
            <a href="/write-for-infoq" title="Write for InfoQ">
                Write for InfoQ
            </a>
        </li>
        <li>
            <a href="/about-c4media" title="About C4Media">
                About C4Media
            </a>
        </li>
        <li>
            <a rel="noreferrer noopener" href="https://c4media.com/diversity" title="Diversity" target="_blank">Diversity</a>
        </li>
    </ul>
</div>


                    <div>
                        <h3 class="widget__heading">Choose your language</h3>








<ul class="language__switcher no-style">
	<li class="active"><a href="#" onclick="return false;" title="InfoQ English">En</a></li>
	<li><a href="https://www.infoq.cn">中文</a></li>
	<li><a href="/jp/">日本</a></li>
	<li><a href="/fr/">Fr</a></li>
</ul>
                    </div>
                </div>

            </div>
            <div data-nosnippet class="actions header__bottom header__bottom__events">
                <div class="actions__left">
                    <div class="header__events-all">











                        <a href="https://devsummit.infoq.com/conference/munich2024?utm_source=infoq&utm_medium=referral&utm_campaign=homepageheader_idsmunich24" rel="nofollow" target="_blank" class="header__event-slot">
                            <picture><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjQvaWRzLW11bmljaC1kYXRlLndlYnAiLCJlZGl0cyI6IHsid2VicCI6IHsgInF1YWxpdHkiOjgwfX19" type="image/webp"><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjQvaWRzLW11bmljaC1kYXRlLndlYnAiLCJlZGl0cyI6IHsianBlZyI6IHsgInF1YWxpdHkiOjgwfX19" type="image/webp"><img src="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjQvaWRzLW11bmljaC1kYXRlLndlYnAiLCJlZGl0cyI6IHsianBlZyI6IHsgInF1YWxpdHkiOjgwfX19" loading="lazy" width="40px" height="40px"></picture>
                            <div>
                                <span>InfoQ Dev Summit Munich</span>
                                <p>Get clarity from senior software practitioners on today's critical dev priorities. Register Now.</p>
                            </div>
                        </a>

                        <a href="https://qconsf.com/?utm_source=infoq&utm_medium=referral&utm_campaign=homepageheader_qsf24" rel="nofollow" target="_blank" class="header__event-slot">
                            <picture><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjQvU0YtdG9wLmpwZyIsImVkaXRzIjogeyJ3ZWJwIjogeyAicXVhbGl0eSI6ODB9fX0=" type="image/webp"><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjQvU0YtdG9wLmpwZyIsImVkaXRzIjogeyJqcGVnIjogeyAicXVhbGl0eSI6ODB9fX0=" type="image/webp"><img src="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjQvU0YtdG9wLmpwZyIsImVkaXRzIjogeyJqcGVnIjogeyAicXVhbGl0eSI6ODB9fX0=" loading="lazy" width="40px" height="40px"></picture>
                            <div>
                                <span>QCon San Francisco</span>
                                <p>Level up your software skills by uncovering the emerging trends you should focus on. Register now.</p>
                            </div>
                        </a>

                        <a href="https://qconlondon.com/?utm_source=infoq&utm_medium=referral&utm_campaign=homepageheader_qlondon25" rel="nofollow" target="_blank" class="header__event-slot">
                            <picture><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjUvbG9uZG9uLXRvcC5qcGciLCJlZGl0cyI6IHsid2VicCI6IHsgInF1YWxpdHkiOjgwfX19" type="image/webp"><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjUvbG9uZG9uLXRvcC5qcGciLCJlZGl0cyI6IHsianBlZyI6IHsgInF1YWxpdHkiOjgwfX19" type="image/webp"><img src="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL2NvbmZlcmVuY2VzLzIwMjUvbG9uZG9uLXRvcC5qcGciLCJlZGl0cyI6IHsianBlZyI6IHsgInF1YWxpdHkiOjgwfX19" loading="lazy" width="40px" height="40px"></picture>
                            <div>
                                <span>QCon London</span>
                                <p>Discover emerging trends, insights, and real-world best practices in software development &amp; tech leadership. Join now.</p>
                            </div>
                        </a>


                         <a href="https://www.infoq.com/software-architects-newsletter/" rel="nofollow" target="_blank" class="header__event-slot">
                            <picture><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL25ld3NsZXR0ZXItY292ZXIuanBlZyIsImVkaXRzIjogeyJ3ZWJwIjogeyAicXVhbGl0eSI6ODB9fX0=" type="image/webp"><source srcset="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL25ld3NsZXR0ZXItY292ZXIuanBlZyIsImVkaXRzIjogeyJqcGVnIjogeyAicXVhbGl0eSI6ODB9fX0=" type="image/webp"><img src="https://imgopt.infoq.com/eyJidWNrZXQiOiAiYXNzZXRzLmluZm9xLmNvbSIsImtleSI6ICJ3ZWIvaGVhZGVyL25ld3NsZXR0ZXItY292ZXIuanBlZyIsImVkaXRzIjogeyJqcGVnIjogeyAicXVhbGl0eSI6ODB9fX0=" loading="lazy" width="40px" height="40px"></picture>
                            <div>
                                <span>The Software Architects' Newsletter</span>
                                <p>Your monthly guide to all the topics, technologies and techniques that every professional needs to know about. Subscribe for free.</p>
                            </div>
                        </a>









                    </div>
                </div>
                <!---->
            </div>
        </div>
    </div>
</header>



                <!--	#######		CONTENT START	#########	 -->
                <main>

	<article data-type="news" class="article">
		<section class="section container white">
			<div class="container__inner">







<p class="crumbs">
	<span data-nosnippet><a href="/" title="InfoQ Homepage">InfoQ Homepage</a></span>




                <span data-nosnippet><a href="/news" title="News">News</a></span>


		<span data-nosnippet class="active">Amazon Introduces Storage Browser for S3</span>





</p>

				<div class="actions">
					<div class="actions__left">








    <div class="article__category cloud">

        <a

	href="/Cloud/"

 class="article__tag box--info" title="Cloud">

            Cloud
        </a>

    </div>

					</div>
					<div class="actions__right">











	<div data-nosnippet class="notice">
		<div class="box--warning">
			<a target="_blank" rel="nofollow" href="https://www.infoq.com/url/t/d8a79bcd-f6ab-4226-ab0a-52ff6eccc6f0/?label=Retool-Event-Promotion-Box ">Enhancing Internal Tools with AI: A Hands-On Guide for Developers and Architects (Webinar Oct 22nd) </a>
		</div>
	</div>

					</div>
				</div>
				<div class="actions heading__container article__heading">
					<div class="actions__left">
						<h1 class="heading">
							Amazon Introduces Storage Browser for S3
						</h1>
					</div>
				</div>














<script type="text/javascript">
	$("#translated_"+InfoQConstants.userDetectedCountryCode.toLowerCase()).show();
</script>

				<div class="columns article__explore">
					<div class="column article__main" data-col="4/6">
						<div class="column article__metadata metadata">
							<div class="actions__left article__actions actions__sidebar">
								<button id="toggleLikeContent" class="icon button button__icon like button__gray icon__like" aria-label="Like">Like</button>










        <button id="bookmarkBtn" data-ref="bookmarkPage" aria-label="Read later"
                class="login button__gray button button__icon icon icon__bookmark icon--only">
        </button>

        <a id="showBookmarks" href="/showbookmarks.action" class="button button__gray button__icon icon icon__bookmark">Bookmarks</a>

        <div id="toastContainer" class="toast-none toast-hide">
                <div class="toast"><span></span></div>
        </div>
        <script type="text/javascript">

                if(loggedIn){
                        $('#showBookmarks').show();
                }

                function performBookmark() {
                        Bookmarks.toggleBookmark('news', '2024/09/amazon-storage-browser-s3');
                }

                infoq.event.on('bookmarkRequested', function(e) {
                        Bookmarks.toggleBookmark('news', '2024/09/amazon-storage-browser-s3');
                });

                infoq.event.on("loaded", function(){
                        if(loggedIn){
                                var href = window.location.href;
                                if(href.indexOf("#bookmarkPage") != -1){
                                        $('#bookmarkBtn').click();
                                }
                        }
                });


                $(document).ready(function() {
                        if(Bookmarks.isContentBookmarked == 'true'){
                                $('#bookmarkBtn').addClass('button__green');
                                $('#bookmarkBtn').removeClass('button__gray');
                        }else{
                                $('#bookmarkBtn').removeClass('button__green');
                                $('#bookmarkBtn').addClass('button__gray');
                        }
                });
</script>

							</div>
							<p class="article__readTime date">Sep 14, 2024<span class="dot"></span>




									2
									min read

							</p>

							<div class="widget article__authors">
								<div>
									<p class="meta">by</p>














<ul class="no-style authors">




        <li data-id="author-Renato-Losio">
            <p class="meta author__bio">

                <a href="/profile/Renato-Losio/" class="avatar author__avatar"></a>
                <span class="author__name">
                    <a href="/profile/Renato-Losio/" class="author__link">Renato Losio</a>
                </span>
            </p>

        </li>

</ul>
								</div>

							</div>


								<div data-nosnippet class="cta_write_infoq">
   <h4>Write for InfoQ</h4>
   <strong>Feed your curiosity.</strong>
   <span style="line-height: 1.6; margin-bottom: 5px;">Help 550k+ global <br/>senior developers <br/>each month stay ahead.</span><a href="https://docs.google.com/forms/d/e/1FAIpQLSehsV5jwuXFRFPIoOQoSXm9aRjYam9bQjKbEHvGZBxsioyGGw/viewform " target="_blank">Get in touch</a>


</div>


							<div class="widgets"></div>
						</div>
						<div class="article__content">
							<!-- Start PSA Section -->




							<!-- End PSA Section -->










<div>

</div>

<div class="article__data">
<p>Amazon has recently announced the alpha release of <a href="https://aws.amazon.com/about-aws/whats-new/2024/09/storage-browser-amazon-s3-alpha-release/">Storage Browser for Amazon S3</a>, providing end users with a simple interface for accessing data stored in S3. The project is available in the AWS Amplify JavaScript and React client libraries.</p>

<p><a href="https://github.com/aws-amplify/amplify-ui/issues/5731">Storage Browser</a> is an open-source <a href="https://ui.docs.amplify.aws/">Amplify UI React</a> component that customers can add to their web applications to provide end-users with a simple interface to access data stored in S3. Using the new interface, developers can grant authorized end-users the ability to browse, download, and upload data in the bucket from their applications.</p>

<p><img alt="" data-src="news/2024/09/amazon-storage-browser-s3/en/resources/1Screenshot 2024-09-11 at 20-44-25 364885226-eb83133e-89f9-40bc-9b4e-4a26e4a89c2b.gif (GIF Image 800 × 494 pixels)-1726147623310.png"  style="width: 800px; height: 494px;" src="https://imgopt.infoq.com/fit-in/3000x4000/filters:quality(85)/filters:no_upscale()/news/2024/09/amazon-storage-browser-s3/en/resources/1Screenshot 2024-09-11 at 20-44-25 364885226-eb83133e-89f9-40bc-9b4e-4a26e4a89c2b.gif (GIF Image 800 × 494 pixels)-1726147623310.png" rel="share"></p>

<p><em>Source: Project GitHub page</em></p>

<p>Danilo Poccia, chief evangelist of EMEA at AWS, <a href="https://aws.amazon.com/blogs/aws/aws-weekly-roundup-amazon-dynamodb-aws-appsync-storage-browser-for-amazon-s3-and-more-september-9-2024/">summarizes</a> the features of the new project:</p>

<blockquote>
<p>An open source Amplify UI React component that you can add to your web applications to provide your end users with a simple interface for data stored in S3. The component uses the new ListCallerAccessGrants API to list all S3 buckets, prefixes, and objects they can access, as defined by their S3 Access Grants.</p>
</blockquote>

<p>According to the documentation on GitHub, Storage Browser for S3 can be installed via npm or by using the tagged versions of the <em>@aws-amplify/ui-react-storage</em> and <em>aws-amplify </em>packages. The following dependencies should be added to the package.json file:<br />
&nbsp;</p>

<pre>
<code>"dependencies": {
	"@aws-amplify/ui-react-storage": "storage-browser",
	"aws-amplify": "storage-browser",
  }</code></pre>

<p>The Amplify project has three main views, starting with the locations view, which is the initial view that shows the root-level S3 resources the user has access to, along with their associated permissions (READ/READWRITE). The location detail view is a file-browser-like interface where users can browse files and folders in S3, as well as upload or download files. The location action view appears when users select an action, such as uploading files.</p>

<p>While the general feedback has been mostly positive, several users have <a href="https://github.com/aws-amplify/amplify-ui/issues/5731#issuecomment-2336979220">requested search support</a>, which is currently lacking. Jason Butz, principal architect and practice lead at DMI, instead <a href="https://www.linkedin.com/posts/jasonbutz_announcing-storage-browser-for-amazon-s3-activity-7238924157248225280-p0q0">highlights</a> a potential use case:</p>

<blockquote>
<p>Have you ever been in a situation where you needed a way for business users to have administrative access to files uploaded to your application? I have, and then we have to talk about how we can provide access to objects in an S3 Bucket in the application and whether the effort is worth it. That may be getting a little easier.</p>
</blockquote>

<p>There are currently three ways to set up authentication and authorization with the storage browser component: AWS IAM Identity Center and S3 Access Grants, which are recommended for granting access on a per-S3-prefix basis; Amplify Auth, the fastest setup option for developers already using Amplify; or Custom Auth. The last option is suggested for applications that have their own identity and authorization services for authenticating and authorizing users. Eduardo Rabelo, senior ccoud Consultant at Serverless Guru, <a href="https://www.linkedin.com/posts/oieduardorabelo_storage-browser-for-amazon-s3-for-web-activity-7238106091799134208-99bi?utm_source=share&amp;utm_medium=member_desktop">comments</a>:</p>

<blockquote>
<p>It is great to see AWS providing opinionated components for developers!</p>
</blockquote>

<p><br />
The AWS team behind the project is seeking feedback from developers, including suggestions for improving APIs, as well as additional features.</p>

<p>&nbsp;</p>












    <div class="author-section-full"> <!-- main wrapper for authors section -->
        <h2>About the Author</h2> <!-- section title -->





            <div class="author" data-id="author-Renato-Losio"> <!-- main wrapper for each author -->
                <a href="/profile/Renato-Losio/" class="avatar author__avatar"> </a>
                <div class="content-author">
                    <h4><strong>Renato Losio</strong></h4>
                    <div class="show-author-bio">
                        <p>
                            <!-- author bio will be inserted by frontend -->
                        </p>
                        <span>
                            <div class="icon button-icon icon__plus-circle"></div><span class="show-more">Show more</span><span class="show-less">Show less</span>
                        </span>
                    </div>
                </div>
            </div>

    </div>

							</div>




























<input type="hidden" name="" value="Thank you for your review!" id="cr_messages_submitSuccess"/>

<input type="hidden" name="" value="Rating is required" id="cr_messages_ratingRequired"/>

<input type="hidden" name="" value="Amazon Introduces Storage Browser for S3" id="cr_item_title"/>

<input type="hidden" name="" value="Renato Losio" id="cr_item_author"/>

<input type="hidden" name="" value="http://www.infoq.com/news/2024/09/amazon-storage-browser-s3/" id="cr_item_url"/>

<input type="hidden" name="" value="news" id="cr_item_ctype"/>

<input type="hidden" name="" value="en" id="cr_item_lang"/>

<input type="hidden" name="" value="1726294620000" id="cr_item_published_time"/>

<input type="hidden" name="" value="2961" id="cr_item_primary_topic"/>

<script type="text/javascript">
    ContentRating.readMessages();
    ContentRating.readContentItem();
</script>
<form class="box__border box form rate contentRatingWidget">
    <h3 class="heading">Rate this Article</h3>
    <div class="criterias">
        <div class="crit" id="relevance_fieldset">
            <div class="crit__name">Adoption</div>
            <span class="stars">
                <input type="radio" id="relevance-star5" name="rating-relevance" value="5" /><label class="star" for="relevance-star5" title="Innovator"></label>
                <input type="radio" id="relevance-star4" name="rating-relevance" value="4" /><label class="star" for="relevance-star4" title="Early adopter"></label>
                <input type="radio" id="relevance-star3" name="rating-relevance" value="3" /><label class="star" for="relevance-star3" title="Early majority"></label>
                <input type="radio" id="relevance-star2" name="rating-relevance" value="2" /><label class="star" for="relevance-star2" title="Late majority"></label>
                <input type="radio" id="relevance-star1" name="rating-relevance" value="1" /><label class="star" for="relevance-star1" title="Laggards"></label>
            </span>
            <span class="stars__total"></span>
        </div>
        <div class="crit" id="style_fieldset">
            <div class="crit__name">Style</div>
            <span class="stars">
                <input type="radio" id="style-star5" name="rating-style" value="5" /><label class="star" for="style-star5" title="Exceptional"></label>
                <input type="radio" id="style-star4" name="rating-style" value="4" /><label class="star" for="style-star4" title="Good"></label>
                <input type="radio" id="style-star3" name="rating-style" value="3" /><label class="star" for="style-star3" title="Average"></label>
                <input type="radio" id="style-star2" name="rating-style" value="2" /><label class="star" for="style-star2" title="Acceptable"></label>
                <input type="radio" id="style-star1" name="rating-style" value="1" /><label class="star" for="style-star1" title="Poor"></label>
            </span>
            <span class="stars__total"></span>
        </div>
    </div>
</form>

<div class="reviews tabs contentRatingWidget">
    <div id="editorReview" class="tab" data-title="Editor Review">
        <form class="box__border form contentRatingWidget" onsubmit="return false;">
            <span class="field input__textarea" aria-required="false">
                <textarea id="editor_input" placeholder="Click to leave your review..." name="textarea" value="" class="field__input"></textarea>
                <p class="input__message field__desc serverCallFeedback"></p>
            </span>
            <input class="button button__large submit_rating" type="submit" value="Submit"/>
        </form>
    </div>

    <div id="chiefEditorReview" class="tab" data-title="Chief Editor Action">
        <form class="box__border form contentRatingWidget" onsubmit="return false;">
            <span class="field input__textarea">
                <textarea id="chiefEditor_input" placeholder="Chief Editor action..." value="" class="field__input"></textarea>
                <p class="input__message field__desc serverCallFeedback"></p>
            </span>

            <div class="actions">
                <div class="actions__left">
                    <input class="button button__large submit_rating" type="submit" value="Submit"/>
                </div>
                <div class="actions__right">
                    <span class="field input__checkbox input--small">
                        <input type="checkbox" id="auth-checkbox" />
                        <label class="label" for="auth-checkbox"><span></span> Author Contacted</label>
                    </span>
                </div>
            </div>
        </form>
    </div>
</div>

<script type="text/javascript">
    if (!InfoQConstants.editorUser || InfoQConstants.editorUser == 'false') {
       $('.contentRatingWidget').remove();
    } else {

        if (InfoQConstants.chiefEditor !== 'undefined' && InfoQConstants.chiefEditor == 'false') {
            $('#chiefEditorReview').remove();
        }
    }
</script>









<div class="widget article__fromTopic topics">

        <div class="widget__head related__for-topic" data-id="7451" data-trk-ref="content_primary_topic">
            <h4 class="heading related__heading">



                This content is in the <a href='/Cloud/'>Cloud</a> topic
            </h4>
        </div>

    <h5 class="heading related__inline">Related Topics:</h5>
    <ul class="no-style topics related__topics topics__small" data-trk-ref="content_related_topic">






                <li data-id="6815">
                    <a href="/development/" class="button related__topic button__small button__black">Development</a>
                </li>





                <li data-id="6816">
                    <a href="/architecture-design/" class="button related__topic button__small button__black">Architecture &amp; Design</a>
                </li>








                <li data-id="3737">
                    <a href="/AWS/" class="button related__topic button__small button__black">AWS</a>
                </li>





                <li data-id="15624">
                    <a href="/React/" class="button related__topic button__small button__black">React</a>
                </li>





                <li data-id="3601">
                    <a href="/S3/" class="button related__topic button__small button__black">S3</a>
                </li>





                <li data-id="7451">
                    <a href="/Cloud/" class="button related__topic button__small button__black">Cloud</a>
                </li>


    </ul>
</div>

						</div>
						<div id="zoom-container"></div>











<script type="text/javascript">
    var uriMapping = "news";
    var showVcr = "false";
    var fillWithVcr = "true";
    var sponsorshipsJson = "{&quot;links&quot;:[{&quot;styleName&quot;:&quot;article&quot;,&quot;style&quot;:&quot;ARTICLE&quot;,&quot;text&quot;:&quot;Evolving the Agile Organization with Evidence-Based Management&quot;,&quot;id&quot;:&quot;b025ea9d-c898-4a90-afda-b9a79b235e11&quot;,&quot;target&quot;:&quot;https://www.infoq.com/vendorcontent/show.action?vcr=0ce62b6c-ed5d-471b-be3f-631b28087232&amp;utm_source=infoq&amp;utm_medium=RSC&amp;utm_campaign=vcr_fixed_link&quot;,&quot;active&quot;:true}]}";
    var sponsoredLinks = $.parseJSON($("<div/>").html(sponsorshipsJson).text()).links;
    var numberOfSponsoredVcrIds = sponsoredLinks != null ? sponsoredLinks.length : 0;

    var maxItems = 5 - numberOfSponsoredVcrIds;
    var displayWidget = false;
    var intervalVcrSponsorEditorial = setInterval(function() {
        if (window.vcrsLoaded) {
            clearInterval(intervalVcrSponsorEditorial);
            if(showVcr || fillWithVcr) {
                if(fillWithVcr) {
                    for(var index in window.vcrList) {
                        if(VCR.isVcrSponsored(sponsoredLinks, window.vcrList[index])) {
                            VCR.addToExcludedList(window.vcrList[index]);
                        }
                    }
                }
                var vcrs = VCR.getByTopicsAndCommunities(window.vcrList, topicIds, communityIds, maxItems, false, null);
                if (vcrs != null && vcrs.length > 0 || (sponsoredLinks != null && sponsoredLinks.length > 0)) {
                    VCR.addToExcludedList(vcrs);
                    getCommonElements(vcrs, uriMapping, "BOTTOM");
                    $('.related__group').find(".rvc__list").css("display", "block");
                    displayWidget = true;
                } else {
                    $('.related__group').find(".rvc__list").parent("li").remove();
                }
            }
            window.contentVcrFinished = true;
            // search for infoq.event.on("contentVcrFinished",... to see how/where it is used
            infoq.event.trigger("contentVcrFinished");
        }
    }, 200);
</script>
<input type="hidden" name="" value="2961" id="cont_item_primary_topic"/>




<script type="text/javascript">
    $(document).ready(function() {
        $.ajax({
            url: "/api/recommendationlinks.action",
            contentType: "application/x-www-form-urlencoded; charset=utf-8",
            type: 'POST',
            data: {
                "primaryTopicAlias": "Cloud",
                "topicIds": "1024,4278,951,2961",
                "title": "Amazon Introduces Storage Browser for S3",
                "contentPath": "/news/2024/09/amazon-storage-browser-s3",
                "language": "en"
            },
            success: displayRelatedEditorial,
            async: false
        });
    });

    function displayRelatedEditorial(data) {
        $('.related__editorial h4').text("Related Editorial");
        if (data && data.length > 0) {
            if(data[0].fromEs) {
                //change title and tracking params
                var box_title="Cloud";
                //replace html entity since it conflicts with style
                box_title=box_title.replace("&amp;","&");
                $('.related__editorial h4').text("Popular in " + box_title);
            }
            for (var i = 0; i < data.length; i++) {
                if (i === 5) {
                    break;
                }
                if (data[i].url.indexOf("/news/2024/09/amazon-storage-browser-s3") !== -1) {
                    console.log("Removing the current item from list...");
                    continue;
                }
                var theLinkURL = data[i].url;
                if(!theLinkURL.endsWith("/")) {
                    theLinkURL = theLinkURL + "/";
                }
                var link = $('<li><h5 class="rvc__title"><a title="" href="' + theLinkURL + '">' + data[i].title + '</a></h5></li>');
                $('.related__editorial ul').append(link);
            }
            $('.related__editorial').show();
            displayWidget = true;
        }else{
            $('.related__editorial').parent("li").remove();
        }

        if(displayWidget==true){
            $('.related__group').attr("data-cols", $('.related__group').find(">li").length);
            $('.related__group').css("display", "flex");
        }
    }
</script>

<ul class="no-style related__group nocontent cards">
    <li>
        <div class="related__editorial">
            <h4 class="heading">Related Editorial</h4>
            <ul></ul>
        </div>
    </li>
    <li>
        <ul class="no-style rvc__list f_rvcbox" data-place="BOTTOM" data-trk-view="true" data-trk-impr="true"

                style="display: block"


        >
            <h4 class="heading">Related Sponsored Content</h4>

            <div class="f_rvcList"></div>


                    <li>
                        <span class="icon rvc__icon icon__small icon__article"></span>
                        <h5 class="rvc__title">

                            <a href="/url/f/b025ea9d-c898-4a90-afda-b9a79b235e11/" class="rvc__link" rel="nofollow">
                                Evolving the Agile Organization with Evidence-Based Management
                            </a>
                        </h5>
                    </li>


        </ul>
    </li>

        <li>
           <div class="related__prmsp f_sponsorship" data-place="BOTTOM" data-trk-view="true" data-trk-impr="true" jsh="{&quot;topic&quot;:&quot;Development&quot;,&quot;id&quot;:&quot;cebad54e-98bc-4f4b-9b1d-9f0d4b1aaee5&quot;,&quot;title&quot;:&quot;Scrum.org TS Spotlight 02/01/2024 - 01/31/2025&quot;}">
                <h4 class="heading">Related Sponsor</h4>


                    <a href="/url/f/412f4b88-ed17-4fee-b90c-a6bb446a1cd0/" target="_blank" rel="nofollow">
                        <img loading="lazy" src="https://imgopt.infoq.com//fit-in/218x500/filters:quality(100)/filters:no_upscale()/sponsorship/topic/cebad54e-98bc-4f4b-9b1d-9f0d4b1aaee5/ScrumLogoRSB-1706173049477.jpg" class="related__img"/>
                    </a>


                <div class="related__desc">
                    <p style="clear: both; padding: 10px 0 0 0;">Scrum.org exists to help people and teams use Professional Scrum to solve complex problems through training, certification, and ongoing learning experiences. <b><a href="/url/f/fc3caa49-bc60-4274-9784-75b41f68a0e8/" target="_blank" rel="nofollow">Learn more</a></b>.</p>

                </div>
           </div>
        </li>



</ul>








					</div>
					<div class="column article__more f_article_rightbar" data-col="2/6">







<script type="text/javascript">
    window.finishedRightbarVcr = false;

    var _gaq = _gaq || [];
	var recomJson ="[{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724839200000,&quot;title&quot;:&quot;Improving Distributed System Data Integrity with Amazon S3 Conditional Writes&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/amazon-s3-conditional-writes&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/amazon-s3-conditional-writes&quot;,&quot;score&quot;:83930},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726480800000,&quot;title&quot;:&quot;AWS Unveils Parallel Computing Service to Accelerate Scientific Discovery&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/aws-parallel-computing-service&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/aws-parallel-computing-service&quot;,&quot;score&quot;:202},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1725698940000,&quot;title&quot;:&quot;AWS CodeBuild Now Supports Mac Builds&quot;,&quot;authorsList&quot;:[&quot;Renato Losio&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/aws-codebuild-mac&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/aws-codebuild-mac&quot;,&quot;score&quot;:181},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1725598800000,&quot;title&quot;:&quot;How AWS Well-Architected Framework Supports Frugal Architecture&quot;,&quot;authorsList&quot;:[&quot;Rafal Gancarz&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/aws-well-architected-frugal&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/aws-well-architected-frugal&quot;,&quot;score&quot;:177},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1725521460000,&quot;title&quot;:&quot;Elastic Returns to Open Source: Will the Community Follow?&quot;,&quot;authorsList&quot;:[&quot;Renato Losio&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/elastic-open-source-agpl&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/elastic-open-source-agpl&quot;,&quot;score&quot;:177},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724407500000,&quot;title&quot;:&quot;How Amazon Aurora Serverless Manages Resources and Scaling for Fleets of 10K+ Instances&quot;,&quot;authorsList&quot;:[&quot;Rafal Gancarz&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/aurora-serverless-scale-resource&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/aurora-serverless-scale-resource&quot;,&quot;score&quot;:157},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724317200000,&quot;title&quot;:&quot;LLM-Powered DevOps Assistant Clio Launches to Help Engineers Manage Cloud Infrastructure&quot;,&quot;authorsList&quot;:[&quot;Matt Saunders&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/ai-devops-clio&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/ai-devops-clio&quot;,&quot;score&quot;:157},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724234400000,&quot;title&quot;:&quot;AWS Introduces Logically Air-Gapped Vault for Enhanced Data Security&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/aws-backup-logically-air-gapped&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/aws-backup-logically-air-gapped&quot;,&quot;score&quot;:156},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/architect-software-for-greener-future/en/smallimage/How to Architect Software for a Greener Future by Sara Bergman-small-1720088398191.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1720429200000,&quot;title&quot;:&quot;How to Architect Software for a Greener Future&quot;,&quot;authorsList&quot;:[&quot;Sara Bergman&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/architect-software-for-greener-future&quot;,&quot;itemPath&quot;:&quot;/articles/architect-software-for-greener-future&quot;,&quot;score&quot;:119},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/set-piece-strategy-sheen-brisals/en/smallimage/TheSetPieceStrategyTacklingComplexityinServerlessApplications-small-1719579748745.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1719910800000,&quot;title&quot;:&quot;The Set Piece Strategy: Tackling Complexity in Serverless Applications&quot;,&quot;authorsList&quot;:[&quot;Sheen Brisals&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/set-piece-strategy-sheen-brisals&quot;,&quot;itemPath&quot;:&quot;/articles/set-piece-strategy-sheen-brisals&quot;,&quot;score&quot;:115},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/netflix-highly-reliable-stateful-systems/en/smallimage/GettyImages-1208363215-small-1715333971540.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1715677200000,&quot;title&quot;:&quot;How Netflix Ensures Highly-Reliable Online Stateful Systems&quot;,&quot;authorsList&quot;:[&quot;Joseph Lynch&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/netflix-highly-reliable-stateful-systems&quot;,&quot;itemPath&quot;:&quot;/articles/netflix-highly-reliable-stateful-systems&quot;,&quot;score&quot;:101},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/aws-lambda-cold-starts-myths/en/smallimage/GettyImages-1459760313-small-1715082888540.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1715245200000,&quot;title&quot;:&quot;Unraveling the Enigma: Debunking Myths Surrounding Lambda Cold Starts&quot;,&quot;authorsList&quot;:[&quot;Mohit Palriwal&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/aws-lambda-cold-starts-myths&quot;,&quot;itemPath&quot;:&quot;/articles/aws-lambda-cold-starts-myths&quot;,&quot;score&quot;:101},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/cellular-architecture/en/smallimage/ChrisPrice-small-1712137530934.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1712737500000,&quot;title&quot;:&quot;Architecting for High Availability in the Cloud with Cellular Architecture&quot;,&quot;authorsList&quot;:[&quot;Chris Price&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/cellular-architecture&quot;,&quot;itemPath&quot;:&quot;/presentations/cellular-architecture&quot;,&quot;score&quot;:101},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/high-availability-in-the-cloud-with-cellular-architecture/en/smallimage/ArchitectingChrisPrice-1710862402588.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1711098000000,&quot;title&quot;:&quot;Architecting for High Availability in the Cloud with Cellular Architecture&quot;,&quot;authorsList&quot;:[&quot;Chris Price&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/high-availability-in-the-cloud-with-cellular-architecture&quot;,&quot;itemPath&quot;:&quot;/articles/high-availability-in-the-cloud-with-cellular-architecture&quot;,&quot;score&quot;:101},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/saas-diagrid/en/smallimage/Joni-Collinge-small-1723545239180.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1726144740000,&quot;title&quot;:&quot;Building SaaS from Scratch Using Cloud-Native Patterns: a Deep Dive Into a Cloud Startup&quot;,&quot;authorsList&quot;:[&quot;Joni Collinge&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/saas-diagrid&quot;,&quot;itemPath&quot;:&quot;/presentations/saas-diagrid&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1725357600000,&quot;title&quot;:&quot;Workspaces in Azure API Management GA: Runtime Isolation and Federated Model of Managing APIs&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/workspaces-azure-apim-ga&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/workspaces-azure-apim-ga&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1725082860000,&quot;title&quot;:&quot;Cloudflare Introduces Automatic SSL/TLS to Secure and Simplify Origin Server Connectivity&quot;,&quot;authorsList&quot;:[&quot;Renato Losio&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/cloudflare-automatic-ssl-origin&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/cloudflare-automatic-ssl-origin&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724925600000,&quot;title&quot;:&quot;Azure Advisor Well-Architected Assessment in Public Preview to Optimize Cloud Infrastructure&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/azure-advisor-waf-assessments&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/azure-advisor-waf-assessments&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724752800000,&quot;title&quot;:&quot;Google Cloud Launches C4 Machine Series: High-Performance Computing and Data Analytics&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/google-cloud-c4-machines-ai&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/google-cloud-c4-machines-ai&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724478060000,&quot;title&quot;:&quot;Spanner Graph: Google Introduces Graph Database on Spanner&quot;,&quot;authorsList&quot;:[&quot;Renato Losio&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/google-spanner-graph&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/google-spanner-graph&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1724407200000,&quot;title&quot;:&quot;Microsoft Expands Azure Data Box Capabilities for Enhanced Offline Data Migration&quot;,&quot;authorsList&quot;:[&quot;Steef-Jan Wiggers&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/08/azure-data-box-new-capabilities&quot;,&quot;itemPath&quot;:&quot;/news/2024/08/azure-data-box-new-capabilities&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/cloud-waste-management/en/smallimage/Cloud-Waste-Management-logo-small-1723458480367.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1723712400000,&quot;title&quot;:&quot;Cloud Waste Management: How to Optimize Your Cloud Resources&quot;,&quot;authorsList&quot;:[&quot;Abhishek Jain&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/cloud-waste-management&quot;,&quot;itemPath&quot;:&quot;/articles/cloud-waste-management&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/uber-migration-hybrid-cloud/en/smallimage/Onprem-NoSQL-to-NewSQL-Based-Hybrid-Cloud-Architecture-logo-small-1722411887733.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1723021200000,&quot;title&quot;:&quot;Uber's Blueprint for Zero-Downtime Migration of Complex Trip Fulfillment Platform&quot;,&quot;authorsList&quot;:[&quot;Madan Thangavelu&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/uber-migration-hybrid-cloud&quot;,&quot;itemPath&quot;:&quot;/articles/uber-migration-hybrid-cloud&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/pulumi-devops/en/smallimage/AdoraNwodo-small-1719482044287.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1720785660000,&quot;title&quot;:&quot;Pulumi Adventures: How Python Empowered My Infrastructure beyond YAML&quot;,&quot;authorsList&quot;:[&quot;Adora Nwodo&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/pulumi-devops&quot;,&quot;itemPath&quot;:&quot;/presentations/pulumi-devops&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/platform-runtime-engineering/en/smallimage/WhenDevOpsRunsItsCourseWeNeedPlatformasaRuntime-small-1719237072642.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1719565200000,&quot;title&quot;:&quot;Platform as a Runtime - the Next Step in Platform Engineering&quot;,&quot;authorsList&quot;:[&quot;Aviran Mordo&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/platform-runtime-engineering&quot;,&quot;itemPath&quot;:&quot;/articles/platform-runtime-engineering&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/cost-optimization-engineering-perspective/en/smallimage/GettyImages-1315542450-small-1715347078454.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1717578300000,&quot;title&quot;:&quot;Million Dollar Lines of Code - an Engineering Perspective on Cloud Cost Optimization&quot;,&quot;authorsList&quot;:[&quot;Erik Peterson&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/cost-optimization-engineering-perspective&quot;,&quot;itemPath&quot;:&quot;/articles/cost-optimization-engineering-perspective&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/three-as-building-successful-platforms/en/smallimage/GettyImages-636032898-small-1715925480228.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1716204600000,&quot;title&quot;:&quot;The Three As of Building A+ Platforms: Acceleration, Autonomy, and Accountability&quot;,&quot;authorsList&quot;:[&quot;Smruti Patel&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/three-as-building-successful-platforms&quot;,&quot;itemPath&quot;:&quot;/articles/three-as-building-successful-platforms&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/jvm-optimization-cloud/en/smallimage/TobiAjila-small-1714145930325.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1715352420000,&quot;title&quot;:&quot;Optimizing JVM for the Cloud: Strategies for Success&quot;,&quot;authorsList&quot;:[&quot;Tobi Ajila&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/jvm-optimization-cloud&quot;,&quot;itemPath&quot;:&quot;/presentations/jvm-optimization-cloud&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/multi-cloud-observability-fluent-bit/en/smallimage/GettyImages-1343168524-small-1713532833350.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1713862800000,&quot;title&quot;:&quot;Multi-Cloud Observability Using Fluent Bit&quot;,&quot;authorsList&quot;:[&quot;Phil Wilkins&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/multi-cloud-observability-fluent-bit&quot;,&quot;itemPath&quot;:&quot;/articles/multi-cloud-observability-fluent-bit&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/durable-execution-control-plane/en/smallimage/SergeyBykov-small-1712657221280.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1713519660000,&quot;title&quot;:&quot;Durable Execution for Control Planes: Building Temporal Cloud on Temporal&quot;,&quot;authorsList&quot;:[&quot;Sergey Bykov&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/durable-execution-control-plane&quot;,&quot;itemPath&quot;:&quot;/presentations/durable-execution-control-plane&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/durable-execution/en/smallimage/SergeyBykov-small-1711532183751.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1712232780000,&quot;title&quot;:&quot;From Smoothie Architecture to Layer Cake with Durable Execution&quot;,&quot;authorsList&quot;:[&quot;Sergey Bykov&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/durable-execution&quot;,&quot;itemPath&quot;:&quot;/presentations/durable-execution&quot;,&quot;score&quot;:1},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726490100000,&quot;title&quot;:&quot;Java News Roundup: Payara Platform, Piranha Cloud, Spring Milestones, JBang, Micrometer, Groovy&quot;,&quot;authorsList&quot;:[&quot;Michael Redlich&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/java-news-roundup-sep09-2024&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/java-news-roundup-sep09-2024&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726477200000,&quot;title&quot;:&quot;Kubernetes Autoscaler Karpenter Reaches 1.0 Milestone&quot;,&quot;authorsList&quot;:[&quot;Matt Saunders&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/karpenter-10&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/karpenter-10&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726214400000,&quot;title&quot;:&quot;CoreWCF Gets Azure Storage Queue Bindings&quot;,&quot;authorsList&quot;:[&quot;Edin Kapić&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/corewcf-azure-storage-queues&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/corewcf-azure-storage-queues&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726141500000,&quot;title&quot;:&quot;Enabling Fast Flow in Software Organizations&quot;,&quot;authorsList&quot;:[&quot;Ben Linders&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/fast-flow-software-organizations&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/fast-flow-software-organizations&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726120800000,&quot;title&quot;:&quot;Lyft Promotes Best Practices for Collaborative Protocol Buffers Design&quot;,&quot;authorsList&quot;:[&quot;Rafal Gancarz&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/lyft-protocol-buffers-design&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/lyft-protocol-buffers-design&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726066800000,&quot;title&quot;:&quot;Vapor 5 Materializes the Future of Server-Side Development in Swift&quot;,&quot;authorsList&quot;:[&quot;Sergio De Simone&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/swift-vapor-5-roadmap&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/swift-vapor-5-roadmap&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/articles/analysis-optimization-change-release-process/en/smallimage/Mastering-Impact-Analysis-Optimizing-Change-logo-small-1724927868071.jpg&quot;,&quot;contentType&quot;:&quot;articles&quot;,&quot;date&quot;:1726045200000,&quot;title&quot;:&quot;Mastering Impact Analysis and Optimizing Change Release Processes&quot;,&quot;authorsList&quot;:[&quot;Tejas Ghadge&quot;],&quot;url&quot;:&quot;https://www.infoq.com/articles/analysis-optimization-change-release-process&quot;,&quot;itemPath&quot;:&quot;/articles/analysis-optimization-change-release-process&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:null,&quot;contentType&quot;:&quot;news&quot;,&quot;date&quot;:1726033740000,&quot;title&quot;:&quot;Security Experts Exploit Airport Security Loophole with SQL Injection&quot;,&quot;authorsList&quot;:[&quot;Renato Losio&quot;],&quot;url&quot;:&quot;https://www.infoq.com/news/2024/09/sql-injection-airport-security&quot;,&quot;itemPath&quot;:&quot;/news/2024/09/sql-injection-airport-security&quot;,&quot;score&quot;:0},{&quot;topicsIds&quot;:null,&quot;imageStoragePath&quot;:&quot;https://imgopt.infoq.com/fit-in/50x50/filters:quality(80)/presentations/rust-efficient-software/en/smallimage/PietroAlbini-small-1720791618626.jpg&quot;,&quot;contentType&quot;:&quot;presentations&quot;,&quot;date&quot;:1725978180000,&quot;title&quot;:&quot;Not Just Memory Safety: How Rust Helps Maintain Efficient Software&quot;,&quot;authorsList&quot;:[&quot;Pietro Albini&quot;],&quot;url&quot;:&quot;https://www.infoq.com/presentations/rust-efficient-software&quot;,&quot;itemPath&quot;:&quot;/presentations/rust-efficient-software&quot;,&quot;score&quot;:0}]";
	var whitepaperVcrsJson = null;
	var topicSponsorshipJson = "{&quot;iconLink&quot;:&quot;/url/f/412f4b88-ed17-4fee-b90c-a6bb446a1cd0/&quot;,&quot;iconHref&quot;:&quot;https://imgopt.infoq.com//fit-in/275x500/filters:quality(100)/filters:no_upscale()/sponsorship/topic/cebad54e-98bc-4f4b-9b1d-9f0d4b1aaee5/ScrumLogoRSB-1706173049477.jpg&quot;,&quot;id&quot;:&quot;5933116a-a560-4d45-93f1-0e7681a5cb67&quot;}";
	var vcrOptionalListJson = null;
	/* do not delete these two, as they are used further in the code */
	var contentDatetimeFormat='MMM dd, yyyy';
	var contentUriMapping="news";
	JSi18n.relatedRightbar_relatedContent='Related Content';
	JSi18n.relatedRightbar_sponsoredContent='Related Sponsored Content';
	JSi18n.relatedRightbar_sponsoredBy='Sponsored by';

	var topicIds = "1024,4278,951,2961";
	var communityIds = "2497,2498";
	var company = "Scrum.org";


    // this event is fired by frontend once all the necessary things have been done(mobile display, moving vcr boxes around when needed...)
    var canStartTrackingCustomRightbar = false;
    infoq.event.on('loaded', function(e) {
        canStartTrackingCustomRightbar = true;
    });

    var intervalRightbar = setInterval(function() {
        if (window.vcrsLoaded) {
            clearInterval(intervalRightbar);
            if(company != null && company != "") {
                whitepaperVcrsJson = VCR.filterByCompany(company, window.vcrList);
            } else {
                whitepaperVcrsJson = VCR.getByTopicsAndCommunities(window.vcrList, topicIds, communityIds, 5, false, null);
            }
            vcrOptionalListJson = VCR.getByTopicsAndCommunities(window.vcrList, topicIds, communityIds, 10, true, null);

            VCR.displayCustomRightbar(recomJson, whitepaperVcrsJson, topicSponsorshipJson);
            VCR.displayCustomRightbarOptionalVcrWidget(vcrOptionalListJson);

            window.finishedRightbarVcr = true;
        }
    }, 200);

    // these two events can happen one before another async(no precedence any can be first or second). Make sure tracking starts when both happened
    var intervalTrackingRightbar = setInterval(function() {
        if(canStartTrackingCustomRightbar && window.finishedRightbarVcr){
            clearInterval(intervalTrackingRightbar);
            VCR.doTrackingCustomRightbar();
        }
    }, 200);


</script>
<noscript>
<div class="widget related__content article__widget">
    <h3 class="widget__heading">Related Content</h3>
    <ul class="no-style cards" data-horizontal="true" data-size="xs" data-tax="">


    </ul>
</div>
</noscript>









<div class="newsletter widget" data-bg="infoq">
	<h3 class="heading"><strong>The InfoQ</strong> Newsletter</h3>
	<p class="intro">
        A round-up of last week&#x2019;s content on InfoQ sent out every Tuesday. Join a community of over 250,000 senior developers.

			<a target="_blank" href="https://assets.infoq.com/newsletter/regular/en/newsletter_sample/newsletter_sample.html">View an example</a>


    </p>
	<div class="newsletter__subscribe">
		<form class="form gdpr" id="floatingNewsletterForm" action="#" onsubmit="floatingNewsletterForm.saveSubscription(); return false;">
			<div class="field input__text input__no-label input__medium newsletter__mail email">
				<label class="field__label label" for="email-newsletter-infoq-guide">Enter your e-mail address</label>
				<input class="field__input input" id="email-newsletter-infoq-guide" placeholder="Enter your e-mail address" type="text">
				<input type="text" name="emailH" id="input_floating_email_h" aria-required="false" style="display:none !important" tabindex="-1" autocomplete="off">
				<input type="hidden" id="floating_fnt" name="fnt" value="3RaMYycgxx3pVLNX"/>
				<input type="hidden" id="floatingNewsletterType" name="footerNewsletterType" value="regular"/>
				<input type="hidden" id="cmpi_f" name="cmpi" value="1"/>
			</div>
			<div class="hidden">
				<span aria-required="false" class="input__select field country">
					<label for="input-floating-newsletter-country" class="label field__label">Select your country</label>
					<select id="input-floating-newsletter-country" class="select field__input">
						<option value="" class="select__option">Select a country</option>
					</select>
					<p class="input__message field__desc"></p>
				</span>
				<span class="input__checkbox field hidden">
					<input type="checkbox" id="gdpr-consent-simple-floating-nl">
					<label for="gdpr-consent-simple-floating-nl" class="label"><span>I consent to InfoQ.com handling my data as explained in this <a href="https://www.infoq.com/privacy-notice">Privacy Notice</a>.</span></label>
				</span>
			</div>
			<input class="button button__medium button__yellow" type="submit" value="Subscribe" onclick="return floatingNewsletterForm.validateEmail('Invalid email address');">
		</form>
		<p class="meta">
			<a href="/privacy-notice/" target="_blank">We protect your privacy.</a>
		</p>

		<span class="success" style="display:none;" id="floatingNewsletterEmailMessage"></span>
	</div>
</div>
<script type="text/javascript">
	var floatingNewsletterForm = new Newsletter('Enter your e-mail address',
			'email-newsletter-infoq-guide', 'floatingNewsletterType','floatingNewsletterEmailMessage', 'floating_fnt', 'input_floating_email_h', 'input-floating-newsletter-country','cmpi_f','floating_box');
</script>

					</div>
				</div>
			</div>
		</section>
	</article>

<script type="text/javascript">
	// global vars that can be used for this page, us ethis section to add more.
	var contentTitle = "Amazon Introduces Storage Browser for S3",
		contentPath = "/news/2024/09/amazon-storage-browser-s3",
		contentUUID = "57de252f-ccea-4f89-80cc-44ac3c5639ea",
		authorUserCSVIds = "126467140";
</script>
<script src="https://cdn.infoq.com/statics_s2_20240917061620/scripts/prism-build.js"></script>
<script src="https://cdn.infoq.com/statics_s2_20240917061620/scripts/lib/MathJax/MathJax.js?config=TeX-AMS_HTML"></script>

                </main>










<footer class="footer ">

	<section data-nosnippet class="section container">
		<div class="container__inner">










<ul data-cols="5" class="no-style columns boxes topic__boxes">

        <li class="development">
            <div class="box__header">

                <a class="t_all_footer_more-boxes-header" href="/development/">Development</a>
            </div>
            <div class="box__content">
                <ul class="no-style box__list small">

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/sql-injection-airport-security/" title="Security Experts Exploit Airport Security Loophole with SQL Injection">Security Experts Exploit Airport Security Loophole with SQL Injection</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/presentations/rust-efficient-software/" title="Not Just Memory Safety: How Rust Helps Maintain Efficient Software">Not Just Memory Safety: How Rust Helps Maintain Efficient Software</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/elastic-open-source-agpl/" title="Elastic Returns to Open Source: Will the Community Follow?">Elastic Returns to Open Source: Will the Community Follow?</a></h5>
                        </li>

                </ul>
            </div>
        </li>

        <li class="architecture-design">
            <div class="box__header">

                <a class="t_all_footer_more-boxes-header" href="/architecture-design/">Architecture &amp; Design</a>
            </div>
            <div class="box__content">
                <ul class="no-style box__list small">

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/lyft-protocol-buffers-design/" title="Lyft Promotes Best Practices for Collaborative Protocol Buffers Design">Lyft Promotes Best Practices for Collaborative Protocol Buffers Design</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/articles/technical-debt-your-friend/" title="How to Make Technical Debt Your Friend">How to Make Technical Debt Your Friend</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/aws-well-architected-frugal/" title="How AWS Well-Architected Framework Supports Frugal Architecture">How AWS Well-Architected Framework Supports Frugal Architecture</a></h5>
                        </li>

                </ul>
            </div>
        </li>

        <li class="culture-methods">
            <div class="box__header">

                <a class="t_all_footer_more-boxes-header" href="/culture-methods/">Culture &amp; Methods</a>
            </div>
            <div class="box__content">
                <ul class="no-style box__list small">

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/podcasts/technical-health-team-culture/" title="Engineering Excellence: Declan Whelan on Technical Health, Agile Practices, and Team Culture">Engineering Excellence: Declan Whelan on Technical Health, Agile Practices, and Team Culture</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/fast-flow-software-organizations/" title="Enabling Fast Flow in Software Organizations">Enabling Fast Flow in Software Organizations</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/podcasts/leadership-autonomy-growth/" title="Engineering Leadership: Balancing Autonomy, Growth, and Culture with Michael Gray">Engineering Leadership: Balancing Autonomy, Growth, and Culture with Michael Gray</a></h5>
                        </li>

                </ul>
            </div>
        </li>

        <li class="ai-ml-data-eng">
            <div class="box__header">

                <a class="t_all_footer_more-boxes-header" href="/ai-ml-data-eng/">AI, ML &amp; Data Engineering</a>
            </div>
            <div class="box__content">
                <ul class="no-style box__list small">

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/podcasts/primer-ai-for-architects/" title="A Primer on AI for Architects with Anthony Alford">A Primer on AI for Architects with Anthony Alford</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/google-gamengen/" title="Google Announces Game Simulation AI GameNGen">Google Announces Game Simulation AI GameNGen</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/helix-production-ready/" title="HelixML Announces Helix 1.0 Release">HelixML Announces Helix 1.0 Release</a></h5>
                        </li>

                </ul>
            </div>
        </li>

        <li class="devops">
            <div class="box__header">

                <a class="t_all_footer_more-boxes-header" href="/devops/">DevOps</a>
            </div>
            <div class="box__content">
                <ul class="no-style box__list small">

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/karpenter-10/" title="Kubernetes Autoscaler Karpenter Reaches 1.0 Milestone">Kubernetes Autoscaler Karpenter Reaches 1.0 Milestone</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/articles/analysis-optimization-change-release-process/" title="Mastering Impact Analysis and Optimizing Change Release Processes">Mastering Impact Analysis and Optimizing Change Release Processes</a></h5>
                        </li>

                        <li>

                            <h5><a class="t_all_footer_more-boxes-item" href="/news/2024/09/aws-codebuild-mac/" title="AWS CodeBuild Now Supports Mac Builds">AWS CodeBuild Now Supports Mac Builds</a></h5>
                        </li>

                </ul>
            </div>
        </li>

</ul>



		</div>
	</section>
	<section data-nosnippet class="container section section__newsletter">
		<div class="columns container__inner">


















<div class="newsletter" data-col="1/2"



			id="infoq-nl"




>
	<h2 class="heading">
		<strong>The InfoQ</strong> Newsletter
	</h2>
	<p class="intro">A round-up of last week&#x2019;s content on InfoQ sent out every Tuesday. Join a community of over 250,000 senior developers.

			<a target="_blank" href="https://assets.infoq.com/newsletter/regular/en/newsletter_sample/newsletter_sample.html">View an example</a>


	</p>
	<ul class="newsletter__features">
		<li>Get a quick overview of content published on a variety of innovator and early adopter technologies</li>
		<li>Learn what you don&#x2019;t know that you don&#x2019;t know</li>
		<li>Stay up to date with the latest information from the topics you are interested in</li>
	</ul>
	<div class="newsletter__subscribe">
		<form class="form gdpr" name="footerNewsletterForm" id="footerNewsletterForm" action="#" onsubmit="footerNewsletter.saveSubscription(); return false;">
			<div class="field newsletter__mail input__text input__no-label input__medium email">
				<label for="email-newsletter-infoq" class="label field__label">Enter your e-mail address</label>
				<input id="email-newsletter-infoq" name="footerNewsletterEmail" placeholder="Enter your e-mail address" class="input field__input" type="text"/>
				<input type="text" name="emailH" id="input_email_h" aria-required="false" style="display:none !important" tabindex="-1" autocomplete="off"/>
				<input type="hidden" id="fnt" name="fnt" value="3RaMYycgxx3pVLNX"/>
				<input type="hidden" id="footerNewsletterType" name="footerNewsletterType" value="regular"/>
				<input type="hidden" id="cmpi" name="cmpi" value="1"/>
			</div>
			<div class="hidden">
				<span aria-required="false" class="input__select field country">
					<label for="input-simple-newsletter-country" class="label field__label">Select your country</label>
					<select id="input-simple-newsletter-country" class="select field__input">
						<option value="" class="select__option">Select a country</option>
					</select>
					<p class="input__message field__desc"></p>
				</span>
				<span class="input__checkbox field hidden">
					<input type="checkbox" id="gdpr-consent-simple-nl">
					<label for="gdpr-consent-simple-nl" class="label"><span>I consent to InfoQ.com handling my data as explained in this <a href="https://www.infoq.com/privacy-notice">Privacy Notice</a>.</span></label>
				</span>
			</div>
			<input type="submit" value="Subscribe" class="button button__medium button__red" onclick="return footerNewsletter.validateEmail('Invalid email address');"/>
		</form>
		<p class="meta">
			<a href="/privacy-notice/" target="_blank">We protect your privacy.</a>
		</p>

		<span class="success" style="display:none;" id="footerNewsletterMessage"></span>
	</div>
	<script type="text/javascript">
		var footerNewsletter = new Newsletter('Enter your e-mail address',
				'email-newsletter-infoq', 'footerNewsletterType','footerNewsletterMessage', 'fnt', 'input_email_h', 'input-simple-newsletter-country', 'cmpi','footer_except_homepage');
	</script>
</div>























    <div data-col="1/2" data-bg="idsMunich" class="event__container">
        <a href="https://devsummit.infoq.com/conference/munich2024?utm_source=infoq&amp;utm_medium=referral&amp;utm_campaign=largefooterad_idsmunich24" target="_blank" class="qconplus__events-slider">
            <div>
                <div class="logo-ids"></div>
                <br>
            </div>
            <p class="intro"><strong> InfoQ Dev Summit Munich <br style="margin:0">September 26-27, 2024 <br style="margin:0"><br></strong>InfoQ Dev Summit Munich is a two-day software conference featuring 22 technical talks sharing actionable insights on Generative AI, security, modern web apps, and more. <br>Learn from senior developers facing the same challenges as you as they share proven tactics, not just trends, empowering you to make smart, focused choices for your immediate dev roadmap.<br><strong class="button button__green cta__button">Register Now</strong></p>
        </a>
    </div>





		</div>
	</section>
	<section data-nosnippet class="section container footer__subfooter align__left">
		<div class="container__inner columns">
			 <div data-col="1/4" class="columns footer__links-wrap">
				  <div class="footer__links">









<a href="/" class="nuxt-link-exact-active active" title="Home">Home</a>

    <a href="/logout.action" title="Sign out">Sign out</a>



<a rel="noreferrer noopener" href="http://qconferences.com/" target="_blank" title="QCon Conferences">QCon Conferences</a>
<a rel="noreferrer noopener" href="https://events.infoq.com/" target="_blank">Events</a>

    <a href="/write-for-infoq/" title="Write for InfoQ">Write for InfoQ</a>
    <a href="/infoq-editors/" title="InfoQ Editors">InfoQ Editors</a>
    <a href="/about-infoq/" title="About InfoQ">About InfoQ</a>
    <a href="/about-c4media/" title="About C4Media">About C4Media</a>

        <a rel="noreferrer noopener" href="https://get.infoq.com/infoq-mediakit/" title="Media Kit" target="_blank">
            Media Kit
        </a>
        <a href="https://devmarketing.c4media.com/?utm_source=infoq" title="InfoQ Developer Marketing Blog" target="_blank">InfoQ Developer Marketing Blog</a>

    <a rel="noreferrer noopener" href="https://c4media.com/diversity" title="Diversity" target="_blank">Diversity</a>

				  </div>

			</div>
			<div data-col="1/4" class="events__list">
				<h4 class="heading footer__heading">Events</h4>
                                <ul class="qcons__list no-style">





                                    <li><span class="icon event__type conference"></span>
                                        <div class="qcon__detail">
                                            <h5 class="heading">
                                                <a rel="noreferrer noopener" href="https://live.infoq.com/?utm_source=infoq&utm_medium=referral&utm_campaign=infoqfooter_il0924" target="_blank">InfoQ Live Roundtable</a>
                                            </h5>
                                            <span class="meta date">SEPTEMBER 24, 2024</span>
                                        </div>
                                    </li>
                                    <li><span class="icon event__type conference"></span>
                                        <div class="qcon__detail">
                                            <h5 class="heading">
                                                <a rel="noreferrer noopener" href="https://devsummit.infoq.com/conference/munich2024?utm_source=infoq&utm_medium=referral&utm_campaign=footer_idsmunich24" target="_blank">InfoQ Dev Summit Munich</a>
                                            </h5>
                                            <span class="meta date">SEPTEMBER 26-27, 2024</span>
                                        </div>
                                    </li>
                                    <li><span class="icon event__type conference"></span>
                                        <div class="qcon__detail">
                                            <h5 class="heading">
                                                <a rel="noreferrer noopener" href="https://qconsf.com/?utm_source=infoq&utm_medium=referral&utm_campaign=footer_qsf24" target="_blank">QCon San Francisco</a>
                                            </h5>
                                            <span class="meta date">NOVEMBER 18-22, 2024</span>
                                        </div>
                                    </li>
                                    <li><span class="icon event__type conference"></span>
                                        <div class="qcon__detail">
                                            <h5 class="heading">
                                                <a rel="noreferrer noopener" href="https://qconlondon.com/?utm_source=infoq&utm_medium=referral&utm_campaign=footer_qlondon25" target="_blank">QCon London</a>
                                            </h5>
                                            <span class="meta date">APRIL 7-9, 2025</span>
                                        </div>
                                    </li>
                                </ul>
			</div>
			<div data-col="1/4" class="footer__social-wrap">
				<h4 class="heading text-left footer__heading">Follow us on </h4>
				<div class="social__links columns social__links__row">


                            <a href="https://www.youtube.com/infoq"><span class="icon icon__large icon__social icon__youtube"></span><div><span class="social__count">Youtube</span><span class="social__followers">223K Followers</span></div></a>
                            <a href="http://www.linkedin.com/company/infoq"><span class="icon icon__large icon__social icon__linkedin"></span><div><span class="social__count">Linkedin</span><span class="social__followers">21K Followers</span></div></a>
							<a href="#" id="footerNewsletterRssLink"><span class="icon icon__large icon__social icon__rss"></span><div><span class="social__count">RSS</span><span class="social__followers">19K Readers</span></div></a>
							<a rel="noreferrer noopener" href="http://twitter.com/infoq" target="_blank"><span class="icon icon__large icon__social icon__twitter"></span><div><span class="social__count">X</span><span class="social__followers">53.4k Followers</span></div></a>
							<a rel="noreferrer noopener" href="https://www.facebook.com/InfoQ-75911537320" target="_blank"><span class="icon icon__large icon__social icon__fb"></span><div><span class="social__count">Facebook</span><span class="social__followers">21K Likes</span></div></a>





								<a rel="noreferrer noopener" href="https://www.amazon.com/dp/B07KMWGNNL" target="_blank"><span class="icon icon__large icon__social icon__alexa"></span><div><span class="social__count">Alexa</span><span class="social__followers">New</span></div></a>





				</div>
			</div>
            <div data-col="1/4" class="footer__stayin-wrap">
                <h4 class="heading text-left footer__heading">Stay in the know</h4>
                <div class="stayIn_panel_container">
                    <a href="/podcasts/" class="stayIn_panel" target="_blank" rel="noreferrer noopener"><span>The InfoQ Podcast</span><img loading="lazy" width="65px" height="64px" src="https://cdn.infoq.com/statics_s2_20240917061620/styles/static/images/ui/footer/infoq-podcast-small.jpg" alt="The InfoQ Podcast"></a>
                    <a href="/podcasts/#engineering_culture" class="stayIn_panel" target="_blank" rel="noreferrer noopener"><span>Engineering Culture Podcast</span><img loading="lazy" width="65px" height="64px" alt="Engineering Culture Podcast" src="https://cdn.infoq.com/statics_s2_20240917061620/styles/static/images/ui/footer/engineering-culture-podcast-small.jpg"></a>
                    <a href="/software-architects-newsletter/" class="stayIn_panel" target="_blank" rel="noreferrer noopener"><span>The Software Architects' Newsletter</span><img loading="lazy" width="65px" height="64px" alt="The Software Architects' Newsletter" src="https://cdn.infoq.com/statics_s2_20240917061620/styles/static/images/ui/footer/architects-newsletter-small.jpg"></a>
                </div>
            </div>

		</div>
	</section>
	<section data-nosnippet class="container footer__bottom section white align__left">
		<div class="container__inner columns">
			<div data-col="2/3" class="column">
				<div class="footer__contact contact columns">


						<span data-col="1/6">
							General Feedback
							<a href="mailto:feedback@infoq.com">feedback@infoq.com</a>
						</span>
						<span data-col="1/6">
							Advertising
							<a href="mailto:sales@infoq.com">sales@infoq.com</a>
						</span>
						<span data-col="1/6">
							Editorial
							<a href="mailto:editors@infoq.com">editors@infoq.com</a>
						</span>
						<span data-col="1/6">
							Marketing
							<a href="mailto:marketing@infoq.com">marketing@infoq.com</a>
						</span>

				</div>
			</div>
			<div class="column" data-col="1/3">
				<p class="footer__more">
					InfoQ.com and all content copyright &#169; 2006-2024 C4Media Inc.<br/>

						<a href="/privacy-notice" target="_blank">Privacy Notice</a>, <a href="/terms-and-conditions " target="_blank">Terms And Conditions</a>, <a href="/cookie-policy " target="_blank">Cookie Policy</a>


				</p>
			</div>
		</div>
	</section>
</footer>
                <!--	#######		SITE END	#########	 -->

        </div>



            <div class="intbt">
                <a href="/int/bt/" title="bt">BT</a>
            </div>








<script type="text/javascript">
  $.when(humanDetectionAsync()).then(
      function(status) {
          $.getScript("/scripts/__hd.ifq?hdt=3RaMYycgxx3pVLNX&ha=" + status);
      }
  );
</script>
<script type="text/javascript">

    var pageFullyLoaded = false;
    // this event is fired by frontend once all the necessary things have been done(mobile display, moving vcr boxes around when needed...)
    infoq.event.on('loaded', function(e) {
        pageFullyLoaded = true;
    });

    infoq.event.on('pageWidthChanged', function(e) {
        // re-execute tracking vcr impressions when this event happens (it only happens when elements are added/removed from page)
        // doTrackVcrImpressions takes into account the data-trk-impr="true" if =false the element was already tracked.
        // this is needed when switching from mobile to desktop or when layout on mobile changes and desktop version is displayed. New elements become visible.
        Tracker.safeExec(Tracker.doTrackVcrImpressions);

        // these 2 need to be called also because we might be on a content page. In case we are not nothing happens
        VCR.doTrackingCustomRightbar();
        VCR.doTrackingCustomRightbarForPresentations()
    });

    //check to see if error page
    if(window.device !== undefined) {
        var intervalImpressions = setInterval(function() {
            var shouldTrack = false;

            // no vcr widgets on index pages
            if(window.isIndexPage) {
                if(window.sponsoredPodcastDone === undefined || window.sponsoredPodcastDone) {
                    shouldTrack = true;
                }
            } else
            //on homepage, bottom widget + 2 native widgets
            if(InfoQConstants.pageType == "HOMEPAGE" && window.finishedVcrOptional1 && window.finishedRelatedVcr && (window.finishedVcrOptional2 === undefined || window.finishedVcrOptional2)) {
                shouldTrack = true;
            } else
            // rightbar widgets + native widgets + content vcr widgets
            if((InfoQConstants.pageType == "NEWS_PAGE" || InfoQConstants.pageType == "ARTICLE_PAGE")
                    && ((window.finishedRightbarVcr || window.finishedRightbarVcr === undefined) && window.contentVcrFinished)) {
                shouldTrack = true;
            } else if ((InfoQConstants.pageType == "PRESENTATION_PAGE")
                    && (window.contentVcrFinished || window.contentVcrFinished  === undefined)
                    && (window.finishedRightbarVcr || window.finishedRightbarVcr  === undefined)
            ) {
                shouldTrack = true;
            } else
            // native widgets + content widgets
            if(window.contentVcrFinished && (window.finishedVcrOptional1 || window.finishedVcrOptional1 === undefined)
                    && (window.finishedVcrOptional2 || window.finishedVcrOptional2 === undefined)) {
                shouldTrack = true;
            }

            // we start tracking only after the page is fully loaded, frontend signals that they finished everything related to page display.
            if(shouldTrack && pageFullyLoaded) {
                clearInterval(intervalImpressions);
                Tracker.safeExec(Tracker.doTrackVcrImpressions);

                // start tracking viewable impressions also only after everything is ready
                function callbackRouter(entries, observer) {
                    var targets = new Array();
                    entries.forEach(function (entry) {
                        var target = entry.target;
                        if (target.dataset.trkView === 'false') return;
                        if (entry.intersectionRatio > 0) {
                            target.dataset.trkView = false;
                            targets.push(target);
                        }
                    });
                    Tracker.doTrackViewableImpressions(targets);
                }
                var elementsForTrackingViewableImpressions = document.querySelectorAll('[data-trk-view="true"]')
                var observer = new IntersectionObserver(callbackRouter, { threshold: 0.3 });
                elementsForTrackingViewableImpressions.forEach(observer.observe.bind(observer));
            }

        }, 500);
    }
    $(document).ready(function () {
        // desktop notifications widget
        Tracker.encodeNotificationLinks($(".f_notificationWidget"));
        // mobile notifications widget
        Tracker.encodeNotificationLinks($(".h_notifications"));
        // desktop notifications page
        Tracker.encodeNotificationLinks($(".notification-page"));
        // mobile notifications page
        Tracker.encodeNotificationLinks($(".notifications_page"));
    });
</script>







<script type="text/javascript">
    if(window.location.hash){
        var hash = window.location.hash.substring(1);
        if(hash == 'subscribe'){
            $('html,body').animate({scrollTop: $('.ftxt3 > .newsletter').offset().top}, 'slow');
        }
    }
</script>
<script type="text/javascript">
	var newsletterSubscriptionURL ='/newsletter/subscribe.action';
	DynamicLinks.updateRssLinks('28NnWBwZ7vsg2gW2hUxPTxIMJ6lywqCE');

	ContentSummary.setSelectedTab('en');
	//when user enters the main content area show default topics in the topics bar
	$("#content-wrapper").mouseenter(function() {
	        showDefaultTopics();
	});


	Bookmarks.contentTitle = "Amazon Introduces Storage Browser for S3";
	Bookmarks.apiUrl = '/widgets/bookmark.action';
    Bookmarks.isContentBookmarked = "false";
</script>
<script type="text/javascript">
var $buoop = {vs:{i:6,f:1,o:10.1,s:1}}
$buoop.ol = window.onload;
$(document).ready(function() {
	 try {if ($buoop.ol) $buoop.ol();}catch (e) {}
	 var e = document.createElement("script");
	 e.setAttribute("type", "text/javascript");
	 e.setAttribute("src", "https://cdn.infoq.com/statics_s2_20240917061620/scripts/lib/browser-update-org/update.js");
	 document.body.appendChild(e);
});
</script>




            <script>
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                    n.queue=[];t=b.createElement(e);t.async=!0;
                    t.src=v;s=b.getElementsByTagName(e)[0];
                    s.parentNode.insertBefore(t,s)}(window,document,'script',
                        'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '842388869148196');
                fbq('track', 'PageView');
            </script>
            <noscript>
                <img height="1" width="1" src="https://www.facebook.com/tr?id=842388869148196&ev=PageView&noscript=1"/>
            </noscript>



            <script type='text/javascript'>
                try {
                    mixpanel.track('page viewed', {
                        'page name' : document.title,
                        'url' : window.location.pathname
                    });
                }
                catch(err) {
                }
            </script>









<!-- Latest Version -->
<script src="https://cc.cdn.civiccomputing.com/9/cookieControl-9.x.min.js" type="text/javascript"></script>
<script>
    const config = {
        apiKey: '8910ea974a96ffb6f927952b4ae9b9b0cc3e5973',
        product: 'PRO_MULTISITE',

        // general settings
        consentCookieExpiry: 90,
        encodeCookie: true,
        sameSiteCookie: true, // if false, cookie set as SameSite=None;secure;
        sameSiteValue: ';secure', // either 'Strict', 'Lax', or 'None'
        subDomains: true,
        initialState: 'notify',   // 'notify','top','box' require pro licence
        notifyOnce: false,
        setInnerHTML: true,

        //layout settings
        layout: 'slideout',
        position: 'left',
        theme: 'light',
        acceptButton: true,
        rejectButton: true,
        closeOnGlobalChange: true,
        closeStyle: 'icon',
        toggleType: 'slider',
        notifyDismissButton: true,
        settingsStyle: 'link',
        excludedCountries: ['US'],

        /*accessibility: {
            disableSiteScrolling: true,
        },*/

        statement: {
            description: 'For more detailed information about the cookies we use, see our',
            name: 'Cookie Policy',
            url: 'https://www.infoq.com/cookie-policy',
            updated: '01/01/2024',
        },

        // cookies starting from 'cookie_expire' are from live.infoq.com but since we use the same tool on the same domain we need to specify those too so
        // that infoq.com cookieControl does not delete live.infoq.com cookies(also infoq.com cookies have been specified in live.infoq.com cookieControl configs)
        necessaryCookies: ['RegUserCookie', 'UserCookie', 'IdpCookie', 'ConversionTrackingV2_','PSAdialog','*P13NWN*','topbarSurvey','__bkm','JSESSIONID','mp_','_mixpanel','CloudFront-Key-Pair-Id','CloudFront-Policy','CloudFront-Signature','cookie_expire','discount_promo_closed','discount_promo_code','discount_promo_submitted','exit_survey_popup','referrer_popup','voting_popup_*','AWSALB','AWSALBCORS'],

        optionalCookies: [
            {
                name: 'analytics',
                label: 'Analytics',
                description: 'Analytical cookies help us to improve our website by collecting and reporting information on its usage.',
                cookies: ['_ga', '_ga*', '_gid', '_gat', '__utma', '__utmt', '__utmb', '__utmc', '__utmz', '__utmv'],
                onAccept: function(){
                    gtag('consent', 'update', {'analytics_storage': 'granted'});
                },
                onRevoke: function(){
                    gtag('consent', 'update', {'analytics_storage': 'denied'});
                }
            },
            {
                name: 'marketing',
                label: 'Advertising',
                description: 'We use advertising cookies to display advertisements to you for our products.',
                onAccept: function(){
                    gtag('consent', 'update', {'ad_storage': 'granted', 'ad_personalization': 'granted', 'ad_user_data': 'granted'});
                },
                onRevoke: function(){
                    gtag('consent', 'update', {'ad_storage': 'denied', 'ad_personalization': 'denied', 'ad_user_data': 'denied'});
                }
            }
        ],

        text : {
            // main preference panels
            title: '<h3>Our use of cookies</h3>',
            intro: 'We use necessary cookies to make our site work. Functional cookies help enhance the performance and functionality of the site. '+
                'We\'d also like to set analytics cookies to help us improve your experience by measuring how you use the site. '+
                'These will be set only if you accept. ',
            acceptSettings: 'I Accept',
            rejectSettings: 'I Do Not Accept',
            necessaryTitle : '<h3>Necessary Cookies</h3>',
            necessaryDescription :  'Necessary cookies enable core functionality ' +
                'such as page navigation and access to secure areas. '+
                'The website cannot function properly without '+
                'these cookies, and can only be disabled by changing '+
                'your browser preferences.',
            closeLabel: 'Close Cookie Control',
            cornerButton: 'Set cookie preferences',
            // main preference panel controls
            on: 'On',
            off : 'Off',
            thirdPartyTitle : 'Some cookies require your attention',
            thirdPartyDescription : 'Consent for the following cookies could not be '+
                'automatically revoked. Please follow the link(s) '+
                'below to opt out manually.',
            // notification panels (only accessible for pro licences)
            notifyTitle : 'Your choice regarding cookies on this site',
            notifyDescription : 'We use cookies to optimise site functionality and '+
                'give you the best possible experience.',
            accept : 'I Accept',
            reject: 'I Do Not Accept',
            settings : 'Settings',
        },
        branding : {
            removeAbout: true,
        },
    };
    // do not load this for local envs only. for testing on local envs remove/modify this condition
    if(InfoQConstants.pageUrl.indexOf('local')===-1){
        CookieControl.load( config );
    }
</script>

    </body>
</html>
<!-- s2 -->
`

import {JSDOM} from "jsdom"
import {findChildNodes} from '../../content_module'


test('infoQ test', () => {
  const dom = new JSDOM(pageSource)
  let articleNode = dom.window.document.querySelector(".article__data")
  let nodeList = findChildNodes(articleNode)

  console.log("*** print paragraph list ***")
  for (let node of nodeList){
    console.log("paragraph: ", node.paragraph)
  }
  console.log(nodeList.length)
  expect(nodeList.length).toBeGreaterThan(0);
});
