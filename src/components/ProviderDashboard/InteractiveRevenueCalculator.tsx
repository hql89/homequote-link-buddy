import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingDown, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InteractiveRevenueCalculatorProps {
  businessName?: string;
  email?: string;
}

export function InteractiveRevenueCalculator({ businessName, email }: InteractiveRevenueCalculatorProps) {
  const { toast } = useToast();
  
  // 1. Input A (Daily Missed Calls): Slider from 1 to 50 (Default: 10)
  const [dailyMissedCalls, setDailyMissedCalls] = useState(10);
  
  // 3. Input B (Conversion Rate %): Slider from 10% to 100% (Default: 50%)
  const [conversionRate, setConversionRate] = useState(50);
  
  // 5. Input C (Average Ticket Value): Slider from $50 to $5,000 (Default: $100)
  const [averageTicket, setAverageTicket] = useState(100);

  // 2. Calculation 1 (Monthly Opportunities)
  const monthlyOpportunities = dailyMissedCalls * 30;
  
  // 4. Calculation 2 (New Monthly Customers)
  const newMonthlyCustomers = Math.floor(monthlyOpportunities * (conversionRate / 100));
  
  // 6. Calculation 3 (Monthly Revenue Lost)
  const monthlyRevenueLost = newMonthlyCustomers * averageTicket;
  
  // 7. Calculation 4 (Annual Opportunity at Risk)
  const annualOpportunityAtRisk = monthlyRevenueLost * 12;

  const handleUpgrade = async () => {
    // In the future, this could be a real Stripe link or Webhook to mivos.ai n8n
    toast({
      title: "Success! We will contact you.",
      description: "Our onboarding team at Mivos will provision your AI Receptionist shortly.",
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  };

  return (
    <Card className="border-2 border-primary shadow-lg overflow-hidden relative">
      <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-4 py-1 text-sm font-semibold rounded-bl-lg flex items-center gap-2">
        <Sparkles className="h-4 w-4" /> Recommended
      </div>
      
      <CardHeader className="bg-primary/5 pb-8">
        <CardTitle className="text-2xl text-primary font-serif">Mivos.ai Receptionist</CardTitle>
        <CardDescription className="text-base text-foreground/80 mt-2 max-w-2xl">
          Be the only business in your market open after 5:00 PM and capture 100% of market demand. 
          Our AI actively books appointments directly onto your calendar, 24/7.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="pt-6">
        <div className="grid md:grid-cols-2 gap-10">
          
          {/* Sliders Section */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-semibold text-foreground">Daily Missed Calls</label>
                <span className="text-xl font-bold text-primary">{dailyMissedCalls} calls</span>
              </div>
              <Slider 
                value={[dailyMissedCalls]} 
                onValueChange={(v) => setDailyMissedCalls(v[0])} 
                min={1} 
                max={50} 
                step={1} 
              />
              <p className="text-xs text-muted-foreground">Calls you miss while on a job, after hours, or on weekends.</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-semibold text-foreground">Conversion Rate</label>
                <span className="text-xl font-bold text-primary">{conversionRate}%</span>
              </div>
              <Slider 
                value={[conversionRate]} 
                onValueChange={(v) => setConversionRate(v[0])} 
                min={10} 
                max={100} 
                step={5} 
              />
              <p className="text-xs text-muted-foreground">Percentage of callers that would book a job.</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-semibold text-foreground">Average Ticket Value</label>
                <span className="text-xl font-bold text-primary">{formatCurrency(averageTicket)}</span>
              </div>
              <Slider 
                value={[averageTicket]} 
                onValueChange={(v) => setAverageTicket(v[0])} 
                min={50} 
                max={5000} 
                step={50} 
              />
              <p className="text-xs text-muted-foreground">Average profit/revenue per completed job.</p>
            </div>
          </div>

          {/* Results Section */}
          <div className="bg-destructive/5 rounded-xl p-6 border border-destructive/20 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <TrendingDown className="h-5 w-5" />
              <h3 className="font-semibold">Revenue Leaking to Competitors</h3>
            </div>
            
            <div className="mt-4 space-y-6">
              <div>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Monthly Lost Revenue</p>
                <p className="text-4xl font-bold text-destructive">{formatCurrency(monthlyRevenueLost)}</p>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Annual Opportunity at Risk</p>
                <p className="text-3xl font-bold text-foreground/80">{formatCurrency(annualOpportunityAtRisk)}</p>
              </div>
            </div>

            <div className="mt-8 p-4 bg-primary/10 rounded-lg text-sm text-foreground/90 font-medium">
              You are letting <span className="font-bold text-destructive">{formatCurrency(monthlyRevenueLost)}</span> a month slide directly to your competitors. 
              Would you spend <span className="font-bold text-primary">$497/month</span> with Mivos to recover <span className="font-bold">{formatCurrency(annualOpportunityAtRisk)}</span> a year? 
              <br/><br/>
              The system pays for itself with your very first captured job.
            </div>

            <Button onClick={handleUpgrade} size="lg" className="w-full mt-6 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground h-14">
              Upgrade Now ($497/mo) <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
          
        </div>
      </CardContent>
    </Card>
  );
}
