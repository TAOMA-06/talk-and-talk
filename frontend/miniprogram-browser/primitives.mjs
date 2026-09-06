const fields = `properties:{value:{type:null,value:''},disabled:Boolean,placeholder:String,maxlength:{type:Number,value:140},type:{type:String,value:'text'},password:Boolean,focus:Boolean},methods:{change(e){this.triggerEvent('input',e.detail);},blur(e){this.triggerEvent('blur',e.detail);},confirm(e){if(e.detail.key==='Enter')this.triggerEvent('confirm',{value:e.detail.value});}}`;
export const primitives = {
  view: {}, text: { styles: ':host { display: inline; }' },
  'root-portal': {},
  button: {
    script: `Component({properties:{disabled:Boolean,loading:Boolean}});`,
    template: '<slot/><button class="_mini-button-target" disabled="{{disabled || loading}}" aria-label="操作"></button>',
    styles: ':host { display:block;position:relative;text-align:center;cursor:pointer; }'
  },
  input: {
    script: `Component({${fields}});`,
    template: '<input class="_mini-input" type="{{password ? \'password\' : (type === \'number\' || type === \'digit\' ? \'number\' : \'text\')}}" value="{{value}}" disabled="{{disabled}}" placeholder="{{placeholder}}" maxlength="{{maxlength}}" bindinput="change" bindblur="blur" bindkeydown="confirm"/>',
    styles: ':host { display:block;min-width:0; }'
  },
  textarea: {
    script: `Component({${fields}});`,
    template: '<textarea class="_mini-textarea" value="{{value}}" disabled="{{disabled}}" placeholder="{{placeholder}}" maxlength="{{maxlength}}" bindinput="change" bindblur="blur"/>',
    styles: ':host { display:block; }'
  },
  image: {
    script: `Component({properties:{src:String,mode:String},data:{resolvedSrc:''},observers:{src(value){this.setData({resolvedSrc:value.startsWith('/assets/')?'/mini'+value:value});}},methods:{loaded(){this.triggerEvent('load',{});},failed(){this.triggerEvent('error',{});}}});`,
    template: '<img class="_mini-image {{mode}}" src="{{resolvedSrc}}" bindload="loaded" binderror="failed" alt=""/>',
    styles: ':host { display:inline-block;overflow:hidden; }'
  },
  'scroll-view': {
    script: `Component({properties:{scrollX:Boolean,scrollY:Boolean,scrollIntoView:String},observers:{scrollIntoView(value){if(value)setTimeout(()=>document.getElementById(value)?.scrollIntoView({block:'nearest'}),0);}}});`,
    template: '<div class="_mini-scroll {{scrollX ? \'horizontal\' : \'\'}} {{scrollY ? \'vertical\' : \'\'}}"><slot/></div>'
  },
  navigator: {
    script: `Component({properties:{url:String,openType:{type:String,value:'navigate'}},methods:{go(){const mode={switchTab:'switchTab',redirect:'redirectTo',reLaunch:'reLaunch',navigateBack:'navigateBack'}[this.data.openType]||'navigateTo';wx[mode]({url:this.data.url});}}});`,
    template: '<span class="_mini-navigator" bindtap="go"><slot/></span>'
  },
  label: { template: '<label><slot/></label>', styles: ':host { display:inline; }' },
  checkbox: {
    script: 'Component({properties:{value:String,checked:Boolean,disabled:Boolean,color:String}});',
    template: '<input class="_mini-checkbox" type="checkbox" value="{{value}}" checked="{{checked}}" disabled="{{disabled}}" style="accent-color:{{color}}"/>',
    styles: ':host { display:inline-block; }'
  },
  radio: {
    script: 'Component({properties:{value:String,checked:Boolean,disabled:Boolean,color:String}});',
    template: '<input class="_mini-checkbox" type="radio" value="{{value}}" checked="{{checked}}" disabled="{{disabled}}" style="accent-color:{{color}}"/>',
    styles: ':host { display:inline-block; }'
  },
  'checkbox-group': {}, 'radio-group': {},
  switch: {
    script: `Component({properties:{checked:Boolean,disabled:Boolean},methods:{changed(e){this.triggerEvent('change',{value:e.detail.checked});}}});`,
    template: '<input class="_mini-checkbox" type="checkbox" role="switch" checked="{{checked}}" disabled="{{disabled}}" catchchange="changed"/>',
    styles: ':host { display:inline-block; }'
  },
  picker: {
    script: `Component({properties:{mode:{type:String,value:'selector'},range:{type:Array,value:[]},rangeKey:String,value:{type:null,value:0},disabled:Boolean,start:String,end:String},methods:{changed(e){this.triggerEvent('change',{value:this.data.mode==='selector'?Number(e.detail.value):e.detail.value});}}});`,
    template: `<slot/><select wx:if="{{mode === 'selector'}}" class="_mini-picker" value="{{value}}" disabled="{{disabled}}" catchchange="changed"><option wx:for="{{range}}" wx:key="index" value="{{index}}">{{rangeKey ? item[rangeKey] : item}}</option></select><input wx:else class="_mini-picker" type="{{mode}}" value="{{value}}" min="{{start}}" max="{{end}}" disabled="{{disabled}}" catchchange="changed"/>`,
    styles: ':host { display:block;position:relative; }'
  },
  'web-view': {
    script: 'Component({properties:{src:String}});',
    template: '<iframe class="_mini-document" src="{{src}}" title="协议文档"/>',
  },
  'live-player': { template: '<text>实时语音尚未开放</text>' },
  'live-pusher': { template: '<text>实时语音尚未开放</text>' },
};
